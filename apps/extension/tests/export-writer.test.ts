import { describe, it, expect } from 'vitest';
import type {
  IMediaStore,
  IMediaMetadata,
  IMediaStoreStatistics,
  ICleanupResult,
} from '@knowledge-extractor/types';
import { ExportWriter } from '../src/background/export/writer.js';
import type { IDownloadGateway } from '../src/background/export/download-gateway.js';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class FakeDownloadGateway implements IDownloadGateway {
  readonly deliveries: { content: Blob; filename: string }[] = [];
  async deliver(content: Blob, filename: string): Promise<void> {
    this.deliveries.push({ content, filename });
  }
  last(): { content: Blob; filename: string } {
    const d = this.deliveries.at(-1);
    if (d === undefined) throw new Error('no delivery');
    return d;
  }
}

/** Media store whose `get` returns bytes for pre-seeded ids only. */
class FakeMediaStore implements IMediaStore {
  private readonly blobs: Map<string, Blob>;
  constructor(entries: Record<string, Uint8Array> = {}) {
    this.blobs = new Map(
      Object.entries(entries).map(([id, bytes]) => [id, new Blob([bytes as BlobPart])]),
    );
  }
  get(id: string): Promise<Blob | null> {
    return Promise.resolve(this.blobs.get(id) ?? null);
  }
  exists(id: string): Promise<boolean> {
    return Promise.resolve(this.blobs.has(id));
  }
  put(): Promise<IMediaMetadata> {
    throw new Error('not implemented');
  }
  getMetadata(): Promise<IMediaMetadata | null> {
    return Promise.resolve(null);
  }
  delete(): Promise<void> {
    return Promise.resolve();
  }
  list(): Promise<IMediaMetadata[]> {
    return Promise.resolve([]);
  }
  statistics(): Promise<IMediaStoreStatistics> {
    return Promise.resolve({ count: 0, totalBytes: 0, countByType: {}, bytesByType: {} });
  }
  verify(): Promise<boolean> {
    return Promise.resolve(false);
  }
  cleanup(): Promise<ICleanupResult> {
    return Promise.resolve({ orphanedBlobs: 0, orphanedMetadata: 0, temporary: 0 });
  }
}

function bytesOf(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

// ---------------------------------------------------------------------------
// Single-file (NDJSON) mode
// ---------------------------------------------------------------------------

describe('ExportWriter — single-file mode', () => {
  it('concatenates appended text into one delivered artifact', async () => {
    const gateway = new FakeDownloadGateway();
    const writer = new ExportWriter(new FakeMediaStore(), gateway);

    writer.begin();
    writer.appendText('export.ndjson', '{"a":1}\n');
    writer.appendText('export.ndjson', '{"b":2}\n');
    const result = await writer.finalize('single-file', 'out.ndjson');

    const text = await gateway.last().content.text();
    expect(text).toBe('{"a":1}\n{"b":2}\n');
    expect(gateway.last().filename).toBe('out.ndjson');
    expect(result.bytes).toBe(bytesOf('{"a":1}\n{"b":2}\n').length);
    expect(result.mediaIncluded).toBe(0);
    expect(result.mediaMissing).toBe(0);
  });

  it('delivers an NDJSON mime type', async () => {
    const gateway = new FakeDownloadGateway();
    const writer = new ExportWriter(new FakeMediaStore(), gateway);
    writer.begin();
    writer.appendText('export.ndjson', '{}\n');
    await writer.finalize('single-file', 'out.ndjson');
    expect(gateway.last().content.type).toBe('application/x-ndjson');
  });

  it('produces an empty artifact when nothing was appended', async () => {
    const gateway = new FakeDownloadGateway();
    const writer = new ExportWriter(new FakeMediaStore(), gateway);
    writer.begin();
    const result = await writer.finalize('single-file', 'empty.ndjson');
    expect(result.bytes).toBe(0);
    expect(await gateway.last().content.text()).toBe('');
  });
});

// ---------------------------------------------------------------------------
// ZIP mode + media resolution
// ---------------------------------------------------------------------------

describe('ExportWriter — zip mode', () => {
  it('resolves binary bytes from the media store at finalize time', async () => {
    const gateway = new FakeDownloadGateway();
    const media = new FakeMediaStore({ m1: bytesOf('IMG'), m2: bytesOf('IMG2') });
    const writer = new ExportWriter(media, gateway);

    writer.begin();
    writer.appendText('r1.md', '# Note');
    writer.writeBinary('media/m1', 'm1');
    writer.writeBinary('media/m2', 'm2');
    const result = await writer.finalize('zip', 'out.zip');

    expect(result.mediaIncluded).toBe(2);
    expect(result.mediaMissing).toBe(0);
    expect(gateway.last().content.type).toBe('application/zip');
    expect(gateway.last().filename).toBe('out.zip');
    expect(result.bytes).toBeGreaterThan(0);
  });

  it('counts missing blobs and skips them without aborting', async () => {
    const gateway = new FakeDownloadGateway();
    // m_present exists; m_absent does not.
    const media = new FakeMediaStore({ m_present: bytesOf('OK') });
    const writer = new ExportWriter(media, gateway);

    writer.begin();
    writer.appendText('r1.md', '# Note');
    writer.writeBinary('media/m_present', 'm_present');
    writer.writeBinary('media/m_absent', 'm_absent');
    const result = await writer.finalize('zip', 'out.zip');

    expect(result.mediaIncluded).toBe(1);
    expect(result.mediaMissing).toBe(1);
    expect(gateway.deliveries).toHaveLength(1); // still delivered
  });

  it('writes a zip with only text parts when there is no media', async () => {
    const gateway = new FakeDownloadGateway();
    const writer = new ExportWriter(new FakeMediaStore(), gateway);
    writer.begin();
    writer.appendText('a.md', '# A');
    writer.appendText('b.md', '# B');
    const result = await writer.finalize('zip', 'out.zip');
    expect(result.mediaIncluded).toBe(0);
    expect(result.mediaMissing).toBe(0);
    expect(result.bytes).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// begin() isolation
// ---------------------------------------------------------------------------

describe('ExportWriter — begin() resets state', () => {
  it('does not carry parts from a previous run into the next', async () => {
    const gateway = new FakeDownloadGateway();
    const writer = new ExportWriter(new FakeMediaStore(), gateway);

    writer.begin();
    writer.appendText('export.ndjson', 'stale\n');
    await writer.finalize('single-file', 'first.ndjson');

    writer.begin(); // reset
    writer.appendText('export.ndjson', 'fresh\n');
    await writer.finalize('single-file', 'second.ndjson');

    expect(await gateway.deliveries[1].content.text()).toBe('fresh\n');
  });
});
