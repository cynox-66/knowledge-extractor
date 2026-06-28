import { describe, it, expect } from 'vitest';
import { MediaType } from '@knowledge-extractor/types';
import { MediaStore } from '../src/media/media-store.js';
import { InMemoryBlobBackend, type IMediaBlobBackend } from '../src/media/backend.js';

function bytesOf(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function freshStore(): { store: MediaStore; backend: IMediaBlobBackend } {
  const backend = new InMemoryBlobBackend();
  return { store: new MediaStore(backend), backend };
}

describe('MediaStore — put/get', () => {
  it('stores and retrieves bytes with correct mime type', async () => {
    const { store } = freshStore();
    await store.put({
      id: 'img1',
      bytes: bytesOf('hello'),
      type: MediaType.IMAGE,
      mimeType: 'image/png',
    });

    const blob = await store.get('img1');
    expect(blob).not.toBeNull();
    expect(blob?.type).toBe('image/png');
    expect(await blob?.text()).toBe('hello');
  });

  it('accepts a Blob as input', async () => {
    const { store } = freshStore();
    const blob = new Blob([bytesOf('blobby') as BlobPart], { type: 'image/jpeg' });
    await store.put({ id: 'img2', bytes: blob, type: MediaType.IMAGE, mimeType: 'image/jpeg' });
    expect(await (await store.get('img2'))?.text()).toBe('blobby');
  });

  it('returns null for a missing id', async () => {
    const { store } = freshStore();
    expect(await store.get('nope')).toBeNull();
    expect(await store.exists('nope')).toBe(false);
  });
});

describe('MediaStore — metadata integrity', () => {
  it('records hash, size, type, path and timestamps', async () => {
    const { store } = freshStore();
    const meta = await store.put({
      id: 'm1',
      bytes: bytesOf('content'),
      type: MediaType.IMAGE,
      mimeType: 'image/png',
      source: 'https://cdn/x.png',
    });
    expect(meta.id).toBe('m1');
    expect(meta.type).toBe(MediaType.IMAGE);
    expect(meta.sizeBytes).toBe(7);
    expect(meta.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(meta.storagePath).toBe('media/images/m1');
    expect(meta.state).toBe('complete');
    expect(meta.source).toBe('https://cdn/x.png');
    expect(Date.parse(meta.createdAt)).not.toBeNaN();
  });

  it('routes media types into distinct directories', async () => {
    const { store } = freshStore();
    const img = await store.put({ id: 'a', bytes: bytesOf('a'), type: MediaType.IMAGE });
    const vid = await store.put({ id: 'b', bytes: bytesOf('b'), type: MediaType.VIDEO });
    const doc = await store.put({ id: 'c', bytes: bytesOf('c'), type: MediaType.DOCUMENT });
    expect(img.storagePath).toBe('media/images/a');
    expect(vid.storagePath).toBe('media/videos/b');
    expect(doc.storagePath).toBe('media/documents/c');
  });
});

describe('MediaStore — duplicate writes', () => {
  it('overwrites bytes but preserves createdAt', async () => {
    const { store } = freshStore();
    const first = await store.put({ id: 'dup', bytes: bytesOf('v1'), type: MediaType.IMAGE });
    await new Promise((r) => setTimeout(r, 2));
    const second = await store.put({
      id: 'dup',
      bytes: bytesOf('v2-longer'),
      type: MediaType.IMAGE,
    });

    expect(second.createdAt).toBe(first.createdAt);
    expect(second.sizeBytes).toBe('v2-longer'.length);
    expect(await (await store.get('dup'))?.text()).toBe('v2-longer');
    expect(await store.list()).toHaveLength(1);
  });
});

describe('MediaStore — delete & cleanup', () => {
  it('delete removes both blob and metadata', async () => {
    const { store } = freshStore();
    await store.put({ id: 'del', bytes: bytesOf('x'), type: MediaType.IMAGE });
    await store.delete('del');
    expect(await store.exists('del')).toBe(false);
    expect(await store.getMetadata('del')).toBeNull();
  });

  it('cleanup removes orphaned blobs (no sidecar)', async () => {
    const { store, backend } = freshStore();
    await backend.write('media/images/orphan', bytesOf('lost'));
    const result = await store.cleanup();
    expect(result.orphanedBlobs).toBe(1);
    expect(await backend.exists('media/images/orphan')).toBe(false);
  });

  it('cleanup removes orphaned metadata (no blob)', async () => {
    const { store, backend } = freshStore();
    await store.put({ id: 'gone', bytes: bytesOf('x'), type: MediaType.IMAGE });
    await backend.delete('media/images/gone'); // blob vanishes, sidecar remains
    const result = await store.cleanup();
    expect(result.orphanedMetadata).toBe(1);
    expect(await store.exists('gone')).toBe(false);
  });

  it('cleanup removes temporary artifacts', async () => {
    const { store, backend } = freshStore();
    await backend.write('media/tmp/halfwrite', bytesOf('partial'));
    const result = await store.cleanup();
    expect(result.temporary).toBe(1);
    expect(await backend.exists('media/tmp/halfwrite')).toBe(false);
  });
});

describe('MediaStore — statistics', () => {
  it('aggregates count and bytes by type', async () => {
    const { store } = freshStore();
    await store.put({ id: 'i1', bytes: bytesOf('aa'), type: MediaType.IMAGE });
    await store.put({ id: 'i2', bytes: bytesOf('bbb'), type: MediaType.IMAGE });
    await store.put({ id: 'v1', bytes: bytesOf('cccc'), type: MediaType.VIDEO });

    const stats = await store.statistics();
    expect(stats.count).toBe(3);
    expect(stats.totalBytes).toBe(2 + 3 + 4);
    expect(stats.countByType[MediaType.IMAGE]).toBe(2);
    expect(stats.countByType[MediaType.VIDEO]).toBe(1);
    expect(stats.bytesByType[MediaType.IMAGE]).toBe(5);
  });
});

describe('MediaStore — verify / corruption detection', () => {
  it('verifies an intact blob', async () => {
    const { store } = freshStore();
    await store.put({ id: 'ok', bytes: bytesOf('intact'), type: MediaType.IMAGE });
    expect(await store.verify('ok')).toBe(true);
  });

  it('detects a corrupted blob (hash mismatch)', async () => {
    const { store, backend } = freshStore();
    await store.put({ id: 'bad', bytes: bytesOf('original'), type: MediaType.IMAGE });
    await backend.write('media/images/bad', bytesOf('tampered')); // same length region differs
    expect(await store.verify('bad')).toBe(false);
  });

  it('detects a truncated blob (size mismatch)', async () => {
    const { store, backend } = freshStore();
    await store.put({ id: 'trunc', bytes: bytesOf('full-length-content'), type: MediaType.IMAGE });
    await backend.write('media/images/trunc', bytesOf('short'));
    expect(await store.verify('trunc')).toBe(false);
  });
});

describe('MediaStore — restart persistence', () => {
  it('rebuilds its index from sidecars on a fresh instance', async () => {
    const backend = new InMemoryBlobBackend();
    const first = new MediaStore(backend);
    await first.put({ id: 'p1', bytes: bytesOf('one'), type: MediaType.IMAGE });
    await first.put({ id: 'p2', bytes: bytesOf('two'), type: MediaType.VIDEO });

    // Fresh store over the same (persistent) backend — simulates restart.
    const second = new MediaStore(backend);
    expect(await second.list()).toHaveLength(2);
    expect(await (await second.get('p1'))?.text()).toBe('one');
    expect((await second.statistics()).count).toBe(2);
  });
});

describe('MediaStore — large files', () => {
  it('stores and verifies a 5 MB blob', async () => {
    const { store } = freshStore();
    const big = new Uint8Array(5 * 1024 * 1024).fill(7);
    const meta = await store.put({ id: 'big', bytes: big, type: MediaType.VIDEO });
    expect(meta.sizeBytes).toBe(5 * 1024 * 1024);
    expect(await store.verify('big')).toBe(true);
    const blob = await store.get('big');
    expect(blob?.size).toBe(5 * 1024 * 1024);
  });
});
