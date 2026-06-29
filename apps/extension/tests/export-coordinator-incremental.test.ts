/**
 * M7 — Incremental Export tests for ExportCoordinator.
 *
 * Covers:
 *  - First full export (no manifest → full snapshot)
 *  - Second incremental export (only new resources)
 *  - Unchanged resources skipped
 *  - Changed resources (newer extractedAt) exported
 *  - Manifest persistence and watermark updates
 *  - Interrupted incremental export resume
 *  - Non-incremental export does not update manifest
 *  - Deterministic manifests (idempotent re-run before watermark update)
 *  - Duplicate protection during incremental run
 *  - Statistics (resourcesSkipped)
 *  - embed-remote: success path
 *  - embed-remote: failure fallback (network error)
 *  - embed-remote: non-2xx fallback
 *  - Progress includes resourcesSkipped
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  ExportTarget,
  ResourceState,
  MediaType,
  BlockType,
  type IResource,
  type IResourceQueryable,
  type IResourceQuery,
  type IEnrichmentSelection,
  type IMediaStore,
  type IMediaMetadata,
  type IMediaStoreStatistics,
  type ICleanupResult,
  type IControlStateStore,
  type IExportManifest,
  type IExportRequest,
  type IExportProgress,
} from '@knowledge-extractor/types';
import { ExportCoordinator } from '../src/background/export/coordinator.js';
import { ExportWriter } from '../src/background/export/writer.js';
import { createSerializerRegistry } from '../src/background/export/registry.js';
import type { IDownloadGateway } from '../src/background/export/download-gateway.js';

// ---------------------------------------------------------------------------
// Fakes (shared with coordinator.test.ts — duplicated here for isolation)
// ---------------------------------------------------------------------------

class InMemoryQueryable implements IResourceQueryable {
  constructor(private readonly resources: IResource[]) {}
  async queryResources(query: IResourceQuery): Promise<IEnrichmentSelection> {
    const filtered = this.resources.filter((r) => r.state === query.state);
    const startIdx =
      query.cursor !== undefined ? filtered.findIndex((r) => r.id === query.cursor) + 1 : 0;
    const items = filtered.slice(startIdx, startIdx + query.pageSize);
    const hasMore = startIdx + query.pageSize < filtered.length;
    return { items, hasMore, ...(hasMore ? { nextCursor: items[items.length - 1].id } : {}) };
  }
}

class FakeMediaStore implements IMediaStore {
  private readonly blobs: Map<string, Blob>;
  constructor(entries: Record<string, Uint8Array> = {}) {
    this.blobs = new Map(Object.entries(entries).map(([id, b]) => [id, new Blob([b as BlobPart])]));
  }
  get(id: string): Promise<Blob | null> {
    return Promise.resolve(this.blobs.get(id) ?? null);
  }
  exists(id: string): Promise<boolean> {
    return Promise.resolve(this.blobs.has(id));
  }
  put(): Promise<IMediaMetadata> {
    throw new Error('ni');
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

class StubControlStateStore implements IControlStateStore {
  readonly state = new Map<string, unknown>();
  async saveCrawlState(key: string, value: unknown): Promise<void> {
    this.state.set(key, value);
  }
  async getCrawlState<T = unknown>(key: string): Promise<T | null> {
    return (this.state.get(key) as T) ?? null;
  }
  async deleteCrawlState(key: string): Promise<void> {
    this.state.delete(key);
  }
  saveSession(): Promise<void> {
    return Promise.resolve();
  }
  getSession(): Promise<null> {
    return Promise.resolve(null);
  }
  listSessions(): Promise<[]> {
    return Promise.resolve([]);
  }
  saveDiagnostics(): Promise<void> {
    return Promise.resolve();
  }
  getDiagnostics(): Promise<null> {
    return Promise.resolve(null);
  }
}

class CaptureGateway implements IDownloadGateway {
  readonly deliveries: { content: Blob; filename: string }[] = [];
  async deliver(content: Blob, filename: string): Promise<void> {
    this.deliveries.push({ content, filename });
  }
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeResource(
  id: string,
  opts: {
    state?: ResourceState;
    mediaIds?: string[];
    extractedAt?: string;
    sourceUri?: string;
  } = {},
): IResource {
  const {
    state = ResourceState.ENRICHED,
    mediaIds = [],
    extractedAt = '2024-01-15T10:00:00.000Z',
    sourceUri = `https://cdn.example.com/${id}.jpg`,
  } = opts;
  return {
    id,
    kind: 'post',
    state,
    source: {
      providerName: 'instagram',
      externalId: id,
      originalUri: `https://example.com/${id}`,
      extractedAt,
    },
    content: [{ type: BlockType.TEXT, value: `content ${id}` }],
    media: mediaIds.map((mid) => ({
      id: mid,
      type: MediaType.IMAGE,
      sourceUri,
    })),
    completeness: { thumbnail: true, metadata: true, media: true, ocr: true },
  };
}

function buildCoordinator(
  resources: IResource[],
  opts: {
    media?: FakeMediaStore;
    store?: StubControlStateStore;
    queryable?: IResourceQueryable;
  } = {},
): {
  coordinator: ExportCoordinator;
  gateway: CaptureGateway;
  store: StubControlStateStore;
  media: FakeMediaStore;
} {
  const media = opts.media ?? new FakeMediaStore();
  const store = opts.store ?? new StubControlStateStore();
  const gateway = new CaptureGateway();
  const writer = new ExportWriter(media, gateway);
  const registry = createSerializerRegistry();
  const queryable = opts.queryable ?? new InMemoryQueryable(resources);
  const coordinator = new ExportCoordinator(queryable, media, store, registry, writer);
  return { coordinator, gateway, store, media };
}

function incrementalJsonRequest(): IExportRequest {
  return {
    target: ExportTarget.JSON,
    state: ResourceState.ENRICHED,
    media: 'none',
    incremental: true,
  };
}

function ndjsonLines(text: string): string[] {
  return text.split('\n').filter((l) => l.length > 0);
}

// ---------------------------------------------------------------------------
// First full export (no manifest → full snapshot)
// ---------------------------------------------------------------------------

describe('ExportCoordinator — incremental: first run is full snapshot', () => {
  it('exports all resources when no manifest exists (null watermark)', async () => {
    const resources = [
      makeResource('r1', { extractedAt: '2024-01-01T00:00:00.000Z' }),
      makeResource('r2', { extractedAt: '2024-01-02T00:00:00.000Z' }),
      makeResource('r3', { extractedAt: '2024-01-03T00:00:00.000Z' }),
    ];
    const { coordinator, gateway } = buildCoordinator(resources);

    const result = await coordinator.runExport(incrementalJsonRequest());

    expect(result.resourcesExported).toBe(3);
    expect(result.resourcesSkipped).toBeUndefined(); // 0 skipped → field omitted
    expect(gateway.deliveries).toHaveLength(1);
    const lines = ndjsonLines(await gateway.deliveries[0].content.text());
    expect(lines).toHaveLength(3);
  });

  it('creates a manifest after the first incremental export completes', async () => {
    const resources = [makeResource('r1', { extractedAt: '2024-01-01T00:00:00.000Z' })];
    const { coordinator, store } = buildCoordinator(resources);

    await coordinator.runExport(incrementalJsonRequest());

    const manifest = (await store.getCrawlState('export_manifest_json')) as IExportManifest | null;
    expect(manifest).not.toBeNull();
    expect(manifest!.target).toBe(ExportTarget.JSON);
    expect(manifest!.lastExportedAt).not.toBeNull();
    expect(manifest!.lastRequestId).not.toBeNull();
    expect(manifest!.resourcesExportedTotal).toBe(1);
    expect(manifest!.exportCount).toBe(1);
    expect(manifest!.createdAt).toBe(manifest!.updatedAt); // first creation
  });

  it('does NOT create a manifest for non-incremental exports', async () => {
    const resources = [makeResource('r1')];
    const { coordinator, store } = buildCoordinator(resources);

    await coordinator.runExport({
      target: ExportTarget.JSON,
      state: ResourceState.ENRICHED,
      media: 'none',
    });

    const manifest = await store.getCrawlState('export_manifest_json');
    expect(manifest).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Second incremental export — delta detection
// ---------------------------------------------------------------------------

describe('ExportCoordinator — incremental: second run exports only new resources', () => {
  it('skips resources extracted before the watermark', async () => {
    const WATERMARK = '2024-06-01T00:00:00.000Z';

    const resources = [
      makeResource('old1', { extractedAt: '2024-01-01T00:00:00.000Z' }), // before watermark
      makeResource('old2', { extractedAt: '2024-05-31T23:59:59.999Z' }), // at watermark boundary
      makeResource('new1', { extractedAt: '2024-06-01T00:00:00.001Z' }), // after watermark
      makeResource('new2', { extractedAt: '2024-07-15T12:00:00.000Z' }), // after watermark
    ];
    const store = new StubControlStateStore();
    // Pre-seed a manifest with a watermark
    await store.saveCrawlState('export_manifest_json', {
      target: ExportTarget.JSON,
      lastExportedAt: WATERMARK,
      lastRequestId: 'prior-run',
      resourcesExportedTotal: 2,
      exportCount: 1,
      createdAt: '2024-06-01T00:00:00.000Z',
      updatedAt: '2024-06-01T00:00:00.000Z',
    } satisfies IExportManifest);

    const { coordinator, gateway } = buildCoordinator(resources, { store });

    const result = await coordinator.runExport(incrementalJsonRequest());

    expect(result.resourcesExported).toBe(2); // new1 + new2
    expect(result.resourcesSkipped).toBe(2); // old1 + old2
    const lines = ndjsonLines(await gateway.deliveries[0].content.text());
    expect(lines.map((l) => JSON.parse(l).resourceId)).toEqual(['new1', 'new2']);
  });

  it('exports equal-timestamp resources as skipped (watermark is inclusive)', async () => {
    const WATERMARK = '2024-06-01T00:00:00.000Z';
    const resources = [
      makeResource('exact', { extractedAt: WATERMARK }), // exactly at watermark → skipped
    ];
    const store = new StubControlStateStore();
    await store.saveCrawlState('export_manifest_json', {
      target: ExportTarget.JSON,
      lastExportedAt: WATERMARK,
      lastRequestId: 'prior',
      resourcesExportedTotal: 1,
      exportCount: 1,
      createdAt: WATERMARK,
      updatedAt: WATERMARK,
    } satisfies IExportManifest);

    const { coordinator, gateway } = buildCoordinator(resources, { store });
    const result = await coordinator.runExport(incrementalJsonRequest());

    expect(result.resourcesExported).toBe(0);
    expect(result.resourcesSkipped).toBe(1);
    // Single-file export still delivers (even if empty) — one delivery with empty content
    expect(gateway.deliveries).toHaveLength(1);
  });

  it('updates the manifest watermark after each successful incremental run', async () => {
    const resources = [makeResource('r1', { extractedAt: '2024-07-20T10:00:00.000Z' })];
    const store = new StubControlStateStore();
    await store.saveCrawlState('export_manifest_json', {
      target: ExportTarget.JSON,
      lastExportedAt: '2024-07-01T00:00:00.000Z',
      lastRequestId: 'run-1',
      resourcesExportedTotal: 5,
      exportCount: 1,
      createdAt: '2024-07-01T00:00:00.000Z',
      updatedAt: '2024-07-01T00:00:00.000Z',
    } satisfies IExportManifest);

    const { coordinator } = buildCoordinator(resources, { store });
    await coordinator.runExport(incrementalJsonRequest(), 'run-2');

    const manifest = (await store.getCrawlState('export_manifest_json')) as IExportManifest;
    expect(manifest.exportCount).toBe(2);
    expect(manifest.resourcesExportedTotal).toBe(6); // 5 + 1
    expect(manifest.lastRequestId).toBe('run-2');
    // The new watermark must be after the old one
    expect(manifest.lastExportedAt! > '2024-07-01T00:00:00.000Z').toBe(true);
  });

  it('accumulates totals correctly across multiple incremental runs', async () => {
    const WATERMARK_1 = '2024-06-01T00:00:00.000Z';
    const WATERMARK_2 = '2024-07-01T00:00:00.000Z';
    const resources = [
      makeResource('a', { extractedAt: '2024-06-15T10:00:00.000Z' }), // after WATERMARK_1, before WATERMARK_2
      makeResource('b', { extractedAt: '2024-07-15T10:00:00.000Z' }), // after WATERMARK_2
    ];

    // Simulate second run (manifest has WATERMARK_2 from second completed run)
    const store = new StubControlStateStore();
    await store.saveCrawlState('export_manifest_json', {
      target: ExportTarget.JSON,
      lastExportedAt: WATERMARK_2,
      lastRequestId: 'run-2',
      resourcesExportedTotal: 10,
      exportCount: 2,
      createdAt: WATERMARK_1,
      updatedAt: WATERMARK_2,
    } satisfies IExportManifest);

    const { coordinator } = buildCoordinator(resources, { store });
    const result = await coordinator.runExport(incrementalJsonRequest(), 'run-3');

    expect(result.resourcesExported).toBe(1); // only 'b'
    expect(result.resourcesSkipped).toBe(1); // 'a' is before WATERMARK_2

    const manifest = (await store.getCrawlState('export_manifest_json')) as IExportManifest;
    expect(manifest.exportCount).toBe(3);
    expect(manifest.resourcesExportedTotal).toBe(11);
    expect(manifest.createdAt).toBe(WATERMARK_1); // preserved from first run
  });
});

// ---------------------------------------------------------------------------
// Manifest persistence
// ---------------------------------------------------------------------------

describe('ExportCoordinator — manifest persistence', () => {
  it('manifest is NOT updated when the export is cancelled', async () => {
    const resources = Array.from({ length: 30 }, (_, i) =>
      makeResource(`r${String(i).padStart(3, '0')}`, {
        extractedAt: '2024-07-20T10:00:00.000Z',
      }),
    );

    const inner = new InMemoryQueryable(resources);
    let coordinatorRef: ExportCoordinator | null = null;
    let queries = 0;
    const queryable: IResourceQueryable = {
      async queryResources(q): Promise<IEnrichmentSelection> {
        queries++;
        const page = await inner.queryResources(q);
        if (queries === 1) coordinatorRef?.cancel();
        return page;
      },
    };

    const store = new StubControlStateStore();
    const { coordinator, gateway } = buildCoordinator(resources, { queryable, store });
    coordinatorRef = coordinator;

    await coordinator.runExport(incrementalJsonRequest());

    // Cancelled → no artifact, no manifest update
    expect(gateway.deliveries).toHaveLength(0);
    const manifest = await store.getCrawlState('export_manifest_json');
    expect(manifest).toBeNull();
  });

  it('getManifest() returns the persisted manifest', async () => {
    const resources = [makeResource('r1', { extractedAt: '2024-07-01T00:00:00.000Z' })];
    const { coordinator } = buildCoordinator(resources);

    expect(await coordinator.getManifest(ExportTarget.JSON)).toBeNull();

    await coordinator.runExport(incrementalJsonRequest(), 'test-run-id');

    const manifest = await coordinator.getManifest(ExportTarget.JSON);
    expect(manifest).not.toBeNull();
    expect(manifest!.lastRequestId).toBe('test-run-id');
  });

  it('manifests for different targets are stored independently', async () => {
    const resources = [makeResource('r1', { extractedAt: '2024-07-01T00:00:00.000Z' })];
    const { coordinator, store } = buildCoordinator(resources);

    await coordinator.runExport(incrementalJsonRequest(), 'json-run');
    await coordinator.runExport(
      {
        target: ExportTarget.MARKDOWN,
        state: ResourceState.ENRICHED,
        media: 'none',
        incremental: true,
      },
      'md-run',
    );

    const jsonManifest = (await store.getCrawlState('export_manifest_json')) as IExportManifest;
    const mdManifest = (await store.getCrawlState('export_manifest_markdown')) as IExportManifest;

    expect(jsonManifest.lastRequestId).toBe('json-run');
    expect(mdManifest.lastRequestId).toBe('md-run');
    expect(jsonManifest.target).toBe(ExportTarget.JSON);
    expect(mdManifest.target).toBe(ExportTarget.MARKDOWN);
  });
});

// ---------------------------------------------------------------------------
// Resume compatibility with incremental
// ---------------------------------------------------------------------------

describe('ExportCoordinator — incremental resume after worker eviction', () => {
  it('reuses the pre-interruption watermark on resume (manifest not yet updated)', async () => {
    const WATERMARK = '2024-06-01T00:00:00.000Z';
    const resources = [
      makeResource('old', { extractedAt: '2024-05-01T00:00:00.000Z' }), // should be skipped
      makeResource('new1', { extractedAt: '2024-06-15T00:00:00.000Z' }), // should be exported
      makeResource('new2', { extractedAt: '2024-07-01T00:00:00.000Z' }), // should be exported
    ];
    const store = new StubControlStateStore();

    // Pre-seed manifest (watermark from previous run)
    await store.saveCrawlState('export_manifest_json', {
      target: ExportTarget.JSON,
      lastExportedAt: WATERMARK,
      lastRequestId: 'run-1',
      resourcesExportedTotal: 5,
      exportCount: 1,
      createdAt: WATERMARK,
      updatedAt: WATERMARK,
    } satisfies IExportManifest);

    // Simulate interrupted export: progress + request persisted, done=false
    await store.saveCrawlState('export_progress', {
      requestId: 'run-2',
      target: ExportTarget.JSON,
      resourcesWritten: 0,
      mediaWritten: 0,
      startedAt: '2024-07-10T12:00:00.000Z',
      updatedAt: '2024-07-10T12:00:01.000Z',
      done: false,
    } satisfies IExportProgress);
    await store.saveCrawlState('export_request', incrementalJsonRequest());

    const { coordinator, gateway } = buildCoordinator(resources, { store });
    await coordinator.resume();

    // Resumed export uses watermark from manifest (not from the incomplete run)
    expect(gateway.deliveries).toHaveLength(1);
    const lines = ndjsonLines(await gateway.deliveries[0].content.text());
    // old is skipped, new1 and new2 are exported
    expect(lines.map((l) => JSON.parse(l).resourceId)).toEqual(['new1', 'new2']);

    // Manifest is now updated with the completed run's watermark
    const manifest = (await store.getCrawlState('export_manifest_json')) as IExportManifest;
    expect(manifest.exportCount).toBe(2);
    expect(manifest.resourcesExportedTotal).toBe(7); // 5 + 2
  });
});

// ---------------------------------------------------------------------------
// Progress includes resourcesSkipped
// ---------------------------------------------------------------------------

describe('ExportCoordinator — incremental progress tracking', () => {
  it('persists resourcesSkipped in the progress record', async () => {
    const WATERMARK = '2024-06-01T00:00:00.000Z';
    const resources = Array.from({ length: 30 }, (_, i) => {
      // First 15: old (before watermark), last 15: new (after watermark)
      const extractedAt = i < 15 ? '2024-05-01T00:00:00.000Z' : '2024-07-01T00:00:00.000Z';
      return makeResource(`r${String(i).padStart(3, '0')}`, { extractedAt });
    });

    const store = new StubControlStateStore();
    await store.saveCrawlState('export_manifest_json', {
      target: ExportTarget.JSON,
      lastExportedAt: WATERMARK,
      lastRequestId: 'prior',
      resourcesExportedTotal: 0,
      exportCount: 1,
      createdAt: WATERMARK,
      updatedAt: WATERMARK,
    } satisfies IExportManifest);

    const saveSpy = vi.spyOn(store, 'saveCrawlState');
    const { coordinator } = buildCoordinator(resources, { store });

    await coordinator.runExport(incrementalJsonRequest());

    // Final progress record should reflect skipped count
    const finalProgress = (await store.getCrawlState('export_progress')) as IExportProgress;
    expect(finalProgress.done).toBe(true);
    expect(finalProgress.resourcesSkipped).toBe(15);
    expect(finalProgress.resourcesWritten).toBe(15);

    // Intermediate progress saves also carry the skip count
    const progressSaves = saveSpy.mock.calls.filter((c) => c[0] === 'export_progress');
    const firstPageProgress = progressSaves[0][1] as IExportProgress;
    expect(typeof firstPageProgress.resourcesSkipped).toBe('number');
  });

  it('result includes resourcesSkipped when resources are skipped', async () => {
    const WATERMARK = '2024-06-01T00:00:00.000Z';
    const resources = [
      makeResource('old', { extractedAt: '2024-05-01T00:00:00.000Z' }),
      makeResource('new', { extractedAt: '2024-07-01T00:00:00.000Z' }),
    ];
    const store = new StubControlStateStore();
    await store.saveCrawlState('export_manifest_json', {
      target: ExportTarget.JSON,
      lastExportedAt: WATERMARK,
      lastRequestId: 'prior',
      resourcesExportedTotal: 1,
      exportCount: 1,
      createdAt: WATERMARK,
      updatedAt: WATERMARK,
    } satisfies IExportManifest);

    const { coordinator } = buildCoordinator(resources, { store });
    const result = await coordinator.runExport(incrementalJsonRequest());

    expect(result.resourcesExported).toBe(1);
    expect(result.resourcesSkipped).toBe(1);
  });

  it('result omits resourcesSkipped when nothing is skipped', async () => {
    const resources = [makeResource('r1', { extractedAt: '2024-07-01T00:00:00.000Z' })];
    const { coordinator } = buildCoordinator(resources);

    const result = await coordinator.runExport(incrementalJsonRequest());

    // No watermark → full export → no skipped → field absent
    expect(result.resourcesSkipped).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// embed-remote media
// ---------------------------------------------------------------------------

describe('ExportCoordinator — embed-remote media inclusion', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('embeds remotely fetched bytes for absent blobs', async () => {
    const fetchedBytes = new Uint8Array([10, 20, 30]);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(fetchedBytes.buffer),
    });
    vi.stubGlobal('fetch', mockFetch);

    const resources = [
      makeResource('r1', { mediaIds: ['m1'], sourceUri: 'https://cdn.example.com/img.jpg' }),
    ];
    // m1 is NOT in the media store (absent locally)
    const media = new FakeMediaStore();
    const { coordinator } = buildCoordinator(resources, { media });

    const result = await coordinator.runExport({
      target: ExportTarget.MARKDOWN,
      state: ResourceState.ENRICHED,
      media: 'embed-remote',
    });

    expect(mockFetch).toHaveBeenCalledWith('https://cdn.example.com/img.jpg');
    // mediaIncluded counts both OPFS-resolved and directly-fetched blobs
    expect(result.mediaIncluded).toBe(1);
    expect(result.mediaMissing).toBe(0);
  });

  it('falls back to remote link when fetch fails (network error)', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new TypeError('network error'));
    vi.stubGlobal('fetch', mockFetch);

    const resources = [
      makeResource('r1', { mediaIds: ['m1'], sourceUri: 'https://cdn.example.com/img.jpg' }),
    ];
    const media = new FakeMediaStore();
    const { coordinator } = buildCoordinator(resources, { media });

    const result = await coordinator.runExport({
      target: ExportTarget.MARKDOWN,
      state: ResourceState.ENRICHED,
      media: 'embed-remote',
    });

    // Graceful fallback: no binary part emitted for the failed fetch
    // mediaMissing from writer (blob was absent from store AND not fetched)
    expect(result.resourcesExported).toBe(1);
    // Media was queued via writeBinary (since blob absent from OPFS and fetch failed →
    // presence set doesn't include m1 → projector emits remote link → no binary part)
    // So mediaIncluded = 0 and mediaMissing = 0 (no binary part was written at all)
    expect(result.mediaIncluded).toBe(0);
  });

  it('falls back gracefully when fetch returns non-2xx', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    vi.stubGlobal('fetch', mockFetch);

    const resources = [
      makeResource('r1', { mediaIds: ['m1'], sourceUri: 'https://cdn.example.com/img.jpg' }),
    ];
    const media = new FakeMediaStore();
    const { coordinator } = buildCoordinator(resources, { media });

    const result = await coordinator.runExport({
      target: ExportTarget.MARKDOWN,
      state: ResourceState.ENRICHED,
      media: 'embed-remote',
    });

    expect(result.resourcesExported).toBe(1);
    expect(result.mediaIncluded).toBe(0);
  });

  it('uses OPFS blob for locally-present media (no fetch needed)', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const resources = [
      makeResource('r1', { mediaIds: ['m1'], sourceUri: 'https://cdn.example.com/img.jpg' }),
    ];
    const media = new FakeMediaStore({ m1: new Uint8Array([1, 2, 3]) }); // locally present
    const { coordinator } = buildCoordinator(resources, { media });

    const result = await coordinator.runExport({
      target: ExportTarget.MARKDOWN,
      state: ResourceState.ENRICHED,
      media: 'embed-remote',
    });

    // Local blob used — fetch never called
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.mediaIncluded).toBe(1);
  });

  it('never calls fetch when inclusion is link-local', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const resources = [
      makeResource('r1', { mediaIds: ['m1'], sourceUri: 'https://cdn.example.com/img.jpg' }),
    ];
    const media = new FakeMediaStore(); // m1 absent
    const { coordinator } = buildCoordinator(resources, { media });

    await coordinator.runExport({
      target: ExportTarget.MARKDOWN,
      state: ResourceState.ENRICHED,
      media: 'link-local',
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('never calls fetch when inclusion is none', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const resources = [
      makeResource('r1', { mediaIds: ['m1'], sourceUri: 'https://cdn.example.com/img.jpg' }),
    ];
    const media = new FakeMediaStore(); // m1 absent
    const { coordinator } = buildCoordinator(resources, { media });

    await coordinator.runExport({
      target: ExportTarget.MARKDOWN,
      state: ResourceState.ENRICHED,
      media: 'none',
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Deterministic behavior
// ---------------------------------------------------------------------------

describe('ExportCoordinator — incremental determinism', () => {
  it('produces identical output for the same watermark on repeated runs', async () => {
    const WATERMARK = '2024-06-01T00:00:00.000Z';
    const resources = [
      makeResource('old', { extractedAt: '2024-05-01T00:00:00.000Z' }),
      makeResource('new', { extractedAt: '2024-07-01T00:00:00.000Z' }),
    ];
    const seedManifest: IExportManifest = {
      target: ExportTarget.JSON,
      lastExportedAt: WATERMARK,
      lastRequestId: 'prior',
      resourcesExportedTotal: 0,
      exportCount: 1,
      createdAt: WATERMARK,
      updatedAt: WATERMARK,
    };

    // Run 1
    const store1 = new StubControlStateStore();
    await store1.saveCrawlState('export_manifest_json', seedManifest);
    const built1 = buildCoordinator(resources, { store: store1 });
    await built1.coordinator.runExport(incrementalJsonRequest(), 'run-a');
    const text1 = await built1.gateway.deliveries[0].content.text();

    // Run 2 (same watermark, same resources)
    const store2 = new StubControlStateStore();
    await store2.saveCrawlState('export_manifest_json', seedManifest);
    const built2 = buildCoordinator(resources, { store: store2 });
    await built2.coordinator.runExport(incrementalJsonRequest(), 'run-b');
    const text2 = await built2.gateway.deliveries[0].content.text();

    // Same resources exported → same content (modulo requestId in filename, not in body)
    const ids1 = ndjsonLines(text1).map((l) => JSON.parse(l).resourceId);
    const ids2 = ndjsonLines(text2).map((l) => JSON.parse(l).resourceId);
    expect(ids1).toEqual(ids2);
  });

  it('all resources pass through on an incremental run with no prior manifest', async () => {
    const resources = [
      makeResource('r1', { extractedAt: '2020-01-01T00:00:00.000Z' }),
      makeResource('r2', { extractedAt: '2023-12-31T00:00:00.000Z' }),
    ];
    const { coordinator, gateway } = buildCoordinator(resources);

    const result = await coordinator.runExport(incrementalJsonRequest());

    expect(result.resourcesExported).toBe(2);
    const lines = ndjsonLines(await gateway.deliveries[0].content.text());
    expect(lines).toHaveLength(2);
  });
});
