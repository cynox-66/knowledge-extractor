import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  IResource,
  IResourceQueryable,
  IResourceQuery,
  IEnrichmentSelection,
  IMediaStore,
  IMediaMetadata,
  IMediaStoreStatistics,
  ICleanupResult,
  IControlStateStore,
  IMediaRetentionPolicy,
  ResourceState,
  MediaType,
  BlockType,
} from '@knowledge-extractor/types';
import { MediaJanitor } from '../src/background/media-janitor.js';

// ---------------------------------------------------------------------------
// chrome.alarms stub (MV3 API not available in Node/vitest)
// ---------------------------------------------------------------------------

const alarmCreateSpy = vi.fn();
const chromeMock = {
  alarms: {
    create: alarmCreateSpy,
  },
};
vi.stubGlobal('chrome', chromeMock);

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

/** Minimal in-memory IMediaStore with real list/statistics/delete logic. */
class FakeMediaStore implements IMediaStore {
  private readonly blobs = new Map<string, IMediaMetadata>();
  readonly deletedIds: string[] = [];
  deleteError: Error | null = null;

  constructor(entries: IMediaMetadata[] = []) {
    for (const m of entries) {
      this.blobs.set(m.id, m);
    }
  }

  async list(): Promise<IMediaMetadata[]> {
    return [...this.blobs.values()];
  }

  async statistics(): Promise<IMediaStoreStatistics> {
    const all = [...this.blobs.values()];
    const totalBytes = all.reduce((s, m) => s + m.sizeBytes, 0);
    const countByType: Record<string, number> = {};
    const bytesByType: Record<string, number> = {};
    for (const m of all) {
      countByType[m.type] = (countByType[m.type] ?? 0) + 1;
      bytesByType[m.type] = (bytesByType[m.type] ?? 0) + m.sizeBytes;
    }
    return { count: all.length, totalBytes, countByType, bytesByType };
  }

  async delete(id: string): Promise<void> {
    if (this.deleteError) throw this.deleteError;
    this.blobs.delete(id);
    this.deletedIds.push(id);
  }

  // unused stubs
  put(): Promise<IMediaMetadata> {
    throw new Error('not implemented');
  }
  get(): Promise<Blob | null> {
    return Promise.resolve(null);
  }
  getMetadata(id: string): Promise<IMediaMetadata | null> {
    return Promise.resolve(this.blobs.get(id) ?? null);
  }
  exists(id: string): Promise<boolean> {
    return Promise.resolve(this.blobs.has(id));
  }
  verify(): Promise<boolean> {
    return Promise.resolve(true);
  }
  cleanup(): Promise<ICleanupResult> {
    return Promise.resolve({ orphanedBlobs: 0, orphanedMetadata: 0, temporary: 0 });
  }
}

/** IMediaStore whose statistics() always throws. */
class ThrowingMediaStore extends FakeMediaStore {
  async statistics(): Promise<IMediaStoreStatistics> {
    throw new Error('storage unavailable');
  }
}

/**
 * In-memory IResourceQueryable. Supports multiple states.
 * Cursor is the id of the last item in the previous page.
 */
class FakeQueryable implements IResourceQueryable {
  constructor(private readonly resources: IResource[]) {}

  async queryResources(query: IResourceQuery): Promise<IEnrichmentSelection> {
    const filtered = this.resources.filter((r) => r.state === query.state);
    const startIdx =
      query.cursor !== undefined ? filtered.findIndex((r) => r.id === query.cursor) + 1 : 0;
    const items = filtered.slice(startIdx, startIdx + query.pageSize);
    const hasMore = startIdx + query.pageSize < filtered.length;
    return {
      items,
      hasMore,
      ...(hasMore ? { nextCursor: items[items.length - 1]!.id } : {}),
    };
  }
}

/** Queryable that throws on any call. */
class ThrowingQueryable implements IResourceQueryable {
  queryResources(): Promise<IEnrichmentSelection> {
    return Promise.reject(new Error('queryable unavailable'));
  }
}

/** Minimal IControlStateStore — only getCrawlState is meaningful here. */
class FakeControlStore implements IControlStateStore {
  private readonly state = new Map<string, unknown>();

  async getCrawlState<T>(key: string): Promise<T | null> {
    return (this.state.get(key) as T) ?? null;
  }
  async saveCrawlState(key: string, value: unknown): Promise<void> {
    this.state.set(key, value);
  }
  async deleteCrawlState(key: string): Promise<void> {
    this.state.delete(key);
  }
  saveSession(): Promise<void> {
    return Promise.resolve();
  }
  getSession(): Promise<never> {
    return Promise.resolve(undefined as never);
  }
  listSessions(): Promise<never> {
    return Promise.resolve([] as never);
  }
  saveDiagnostics(): Promise<void> {
    return Promise.resolve();
  }
  getDiagnostics(): Promise<never> {
    return Promise.resolve(undefined as never);
  }
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeResource(
  id: string,
  opts: { state?: ResourceState; mediaIds?: string[] } = {},
): IResource {
  const { state = ResourceState.ENRICHED, mediaIds = [] } = opts;
  return {
    id,
    kind: 'test-post',
    state,
    source: {
      providerName: 'test',
      externalId: id,
      originalUri: `https://example.com/${id}`,
      extractedAt: '2024-01-01T00:00:00.000Z',
    },
    content: [{ type: BlockType.TEXT, value: `content for ${id}` }],
    media: mediaIds.map((mid) => ({
      id: mid,
      type: MediaType.IMAGE,
      sourceUri: `https://cdn/${mid}.jpg`,
    })),
    completeness: { thumbnail: false, metadata: true, media: true, ocr: true },
  };
}

function makeVideoResource(id: string, mediaIds: string[]): IResource {
  const r = makeResource(id, { mediaIds });
  return {
    ...r,
    media: r.media.map((m) => ({ ...m, type: MediaType.VIDEO })),
  };
}

/** Build IMediaMetadata. lastAccess defaults to an ISO string derived from offset. */
function makeMetadata(
  id: string,
  opts: { sizeBytes?: number; lastAccess?: string; type?: MediaType } = {},
): IMediaMetadata {
  const {
    sizeBytes = 1024,
    lastAccess = `2024-01-01T00:00:0${id.charCodeAt(0) % 10}.000Z`,
    type = MediaType.IMAGE,
  } = opts;
  return {
    id,
    type,
    mimeType: type === MediaType.VIDEO ? 'video/mp4' : 'image/jpeg',
    sizeBytes,
    hash: `hash-${id}`,
    storagePath: `media/${id}`,
    state: 'complete',
    createdAt: '2024-01-01T00:00:00.000Z',
    lastAccess,
    source: `https://cdn/${id}`,
  };
}

const keepPolicy: IMediaRetentionPolicy = {
  fullMediaMode: 'keep',
  retainVideo: false,
};

function cachePolicy(maxCacheBytes: number, retainVideo = false): IMediaRetentionPolicy {
  return { fullMediaMode: 'cache', maxCacheBytes, retainVideo };
}

// ---------------------------------------------------------------------------
// Suite: policy=keep
// ---------------------------------------------------------------------------

describe('MediaJanitor — policy=keep', () => {
  it('returns a clean report without evicting anything', async () => {
    const media = [makeMetadata('a', { sizeBytes: 10_000_000 })];
    const resource = makeResource('r1', { mediaIds: ['a'] });
    const store = new FakeMediaStore(media);
    const janitor = new MediaJanitor(store, new FakeQueryable([resource]), keepPolicy);

    const report = await janitor.runPass();

    expect(report.completedCleanly).toBe(true);
    expect(report.mediaEvicted).toBe(0);
    expect(store.deletedIds).toHaveLength(0);
  });

  it('does not query storage at all under keep policy', async () => {
    const querySpy = vi.fn();
    const queryable: IResourceQueryable = { queryResources: querySpy };
    const store = new FakeMediaStore();
    const janitor = new MediaJanitor(store, queryable, keepPolicy);

    await janitor.runPass();
    expect(querySpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Suite: cache under cap
// ---------------------------------------------------------------------------

describe('MediaJanitor — cache under cap', () => {
  it('returns skippedUnderCap=true and evicts nothing when totalBytes ≤ cap', async () => {
    const media = [makeMetadata('m1', { sizeBytes: 100 }), makeMetadata('m2', { sizeBytes: 200 })];
    const store = new FakeMediaStore(media);
    const janitor = new MediaJanitor(store, new FakeQueryable([]), cachePolicy(1000));

    const report = await janitor.runPass();

    expect(report.skippedUnderCap).toBe(true);
    expect(report.mediaEvicted).toBe(0);
    expect(report.completedCleanly).toBe(true);
    expect(store.deletedIds).toHaveLength(0);
  });

  it('skippedUnderCap=true when totalBytes === cap (exact boundary)', async () => {
    const store = new FakeMediaStore([makeMetadata('m1', { sizeBytes: 500 })]);
    const janitor = new MediaJanitor(store, new FakeQueryable([]), cachePolicy(500));

    const report = await janitor.runPass();
    expect(report.skippedUnderCap).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Suite: LRU eviction ordering
// ---------------------------------------------------------------------------

describe('MediaJanitor — LRU ordering', () => {
  it('evicts the oldest-accessed blobs first', async () => {
    // Three blobs, each 100 bytes. Cap = 200. Must free ≥ 100 bytes → evict 1 oldest.
    const media = [
      makeMetadata('new', { sizeBytes: 100, lastAccess: '2024-03-01T00:00:00.000Z' }),
      makeMetadata('old', { sizeBytes: 100, lastAccess: '2024-01-01T00:00:00.000Z' }),
      makeMetadata('mid', { sizeBytes: 100, lastAccess: '2024-02-01T00:00:00.000Z' }),
    ];
    const resources = [makeResource('r', { mediaIds: ['old', 'mid', 'new'] })];
    const store = new FakeMediaStore(media);
    const janitor = new MediaJanitor(store, new FakeQueryable(resources), cachePolicy(200));

    const report = await janitor.runPass();

    expect(report.mediaEvicted).toBe(1);
    expect(store.deletedIds).toEqual(['old']);
  });

  it('evicts multiple blobs in oldest-first order until under cap', async () => {
    const media = [
      makeMetadata('a', { sizeBytes: 100, lastAccess: '2024-01-01T00:00:01.000Z' }),
      makeMetadata('b', { sizeBytes: 100, lastAccess: '2024-01-01T00:00:02.000Z' }),
      makeMetadata('c', { sizeBytes: 100, lastAccess: '2024-01-01T00:00:03.000Z' }),
      makeMetadata('d', { sizeBytes: 100, lastAccess: '2024-01-01T00:00:04.000Z' }),
    ];
    const resources = [makeResource('r', { mediaIds: ['a', 'b', 'c', 'd'] })];
    const store = new FakeMediaStore(media);
    // totalBytes = 400, cap = 150 → must free 250 bytes → evict 3 oldest
    const janitor = new MediaJanitor(store, new FakeQueryable(resources), cachePolicy(150));

    const report = await janitor.runPass();

    expect(report.mediaEvicted).toBe(3);
    expect(store.deletedIds).toEqual(['a', 'b', 'c']);
    expect(store.deletedIds).not.toContain('d');
  });

  it('stops eviction as soon as enough bytes are freed', async () => {
    const media = [
      makeMetadata('x1', { sizeBytes: 300, lastAccess: '2024-01-01T00:00:01.000Z' }),
      makeMetadata('x2', { sizeBytes: 300, lastAccess: '2024-01-01T00:00:02.000Z' }),
    ];
    const resources = [makeResource('r', { mediaIds: ['x1', 'x2'] })];
    const store = new FakeMediaStore(media);
    // totalBytes=600, cap=400 → need to free 200 → x1(300) alone is enough
    const janitor = new MediaJanitor(store, new FakeQueryable(resources), cachePolicy(400));

    const report = await janitor.runPass();

    expect(report.mediaEvicted).toBe(1);
    expect(store.deletedIds).toEqual(['x1']);
  });
});

// ---------------------------------------------------------------------------
// Suite: eviction invariant — non-ENRICHED resources
// ---------------------------------------------------------------------------

describe('MediaJanitor — eviction invariant', () => {
  it('never evicts blobs whose parent resource is DISCOVERED', async () => {
    const media = [makeMetadata('m1', { sizeBytes: 1000 })];
    const resource = makeResource('r1', {
      state: ResourceState.DISCOVERED,
      mediaIds: ['m1'],
    });
    const store = new FakeMediaStore(media);
    // cap = 0 → would always want to evict if invariant is ignored
    const janitor = new MediaJanitor(store, new FakeQueryable([resource]), cachePolicy(0));

    const report = await janitor.runPass();

    expect(store.deletedIds).toHaveLength(0);
    expect(report.skippedNotEnriched).toBe(1);
    expect(report.mediaEvicted).toBe(0);
    expect(report.completedCleanly).toBe(true);
  });

  it('never evicts blobs whose parent resource is EXTRACTED', async () => {
    const media = [makeMetadata('m1', { sizeBytes: 1000 })];
    const resource = makeResource('r1', { state: ResourceState.EXTRACTED, mediaIds: ['m1'] });
    const store = new FakeMediaStore(media);
    const janitor = new MediaJanitor(store, new FakeQueryable([resource]), cachePolicy(0));

    const report = await janitor.runPass();

    expect(store.deletedIds).toHaveLength(0);
    expect(report.skippedNotEnriched).toBeGreaterThan(0);
  });

  it('never evicts blobs whose parent resource is HYDRATED', async () => {
    const media = [makeMetadata('m1', { sizeBytes: 1000 })];
    const resource = makeResource('r1', { state: ResourceState.HYDRATED, mediaIds: ['m1'] });
    const store = new FakeMediaStore(media);
    const janitor = new MediaJanitor(store, new FakeQueryable([resource]), cachePolicy(0));

    const report = await janitor.runPass();

    expect(store.deletedIds).toHaveLength(0);
    expect(report.skippedNotEnriched).toBeGreaterThan(0);
  });

  it('evicts blobs whose parent resource is ENRICHED (eligible state)', async () => {
    const media = [makeMetadata('m1', { sizeBytes: 1000 })];
    const resource = makeResource('r1', { state: ResourceState.ENRICHED, mediaIds: ['m1'] });
    const store = new FakeMediaStore(media);
    const janitor = new MediaJanitor(store, new FakeQueryable([resource]), cachePolicy(0));

    const report = await janitor.runPass();

    expect(store.deletedIds).toContain('m1');
    expect(report.mediaEvicted).toBe(1);
  });

  it('evicts blobs whose parent resource is EXPORTED (eligible state)', async () => {
    const media = [makeMetadata('m1', { sizeBytes: 1000 })];
    const resource = makeResource('r1', { state: ResourceState.EXPORTED, mediaIds: ['m1'] });
    const store = new FakeMediaStore(media);
    const janitor = new MediaJanitor(store, new FakeQueryable([resource]), cachePolicy(0));

    const report = await janitor.runPass();

    expect(store.deletedIds).toContain('m1');
    expect(report.mediaEvicted).toBe(1);
  });

  it('mixed: only evicts ENRICHED blobs, skips DISCOVERED blobs', async () => {
    const media = [
      makeMetadata('safe', { sizeBytes: 500, lastAccess: '2024-01-01T00:00:01.000Z' }),
      makeMetadata('eligible', { sizeBytes: 500, lastAccess: '2024-01-01T00:00:02.000Z' }),
    ];
    const resources = [
      makeResource('r-safe', { state: ResourceState.DISCOVERED, mediaIds: ['safe'] }),
      makeResource('r-ok', { state: ResourceState.ENRICHED, mediaIds: ['eligible'] }),
    ];
    const store = new FakeMediaStore(media);
    // totalBytes=1000, cap=600 → need to free 400 bytes
    const janitor = new MediaJanitor(store, new FakeQueryable(resources), cachePolicy(600));

    const report = await janitor.runPass();

    expect(store.deletedIds).toEqual(['eligible']);
    expect(store.deletedIds).not.toContain('safe');
    expect(report.skippedNotEnriched).toBe(1);
    expect(report.mediaEvicted).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Suite: pinned resources
// ---------------------------------------------------------------------------

describe('MediaJanitor — pinned resources', () => {
  it('never evicts blobs whose parent resource is pinned', async () => {
    const media = [makeMetadata('m1', { sizeBytes: 1000 })];
    const resource = makeResource('r1', { state: ResourceState.ENRICHED, mediaIds: ['m1'] });
    const store = new FakeMediaStore(media);
    const controlStore = new FakeControlStore();
    await controlStore.saveCrawlState('pinned_resource_ids', ['r1']);

    const janitor = new MediaJanitor(
      store,
      new FakeQueryable([resource]),
      cachePolicy(0),
      controlStore,
    );
    const report = await janitor.runPass();

    expect(store.deletedIds).toHaveLength(0);
    expect(report.skippedPinned).toBe(1);
    expect(report.mediaEvicted).toBe(0);
  });

  it('evicts non-pinned while skipping pinned', async () => {
    const media = [
      makeMetadata('pinned-m', { sizeBytes: 400, lastAccess: '2024-01-01T00:00:01.000Z' }),
      makeMetadata('free-m', { sizeBytes: 400, lastAccess: '2024-01-01T00:00:02.000Z' }),
    ];
    const resources = [
      makeResource('pinned-r', { state: ResourceState.ENRICHED, mediaIds: ['pinned-m'] }),
      makeResource('free-r', { state: ResourceState.ENRICHED, mediaIds: ['free-m'] }),
    ];
    const store = new FakeMediaStore(media);
    const controlStore = new FakeControlStore();
    await controlStore.saveCrawlState('pinned_resource_ids', ['pinned-r']);

    // totalBytes=800, cap=400 → need 400 bytes; pinned blob skipped → evict free-m
    const janitor = new MediaJanitor(
      store,
      new FakeQueryable(resources),
      cachePolicy(400),
      controlStore,
    );
    const report = await janitor.runPass();

    expect(store.deletedIds).toContain('free-m');
    expect(store.deletedIds).not.toContain('pinned-m');
    expect(report.skippedPinned).toBe(1);
    expect(report.mediaEvicted).toBe(1);
  });

  it('treats empty pinned list as no pins', async () => {
    const media = [makeMetadata('m1', { sizeBytes: 1000 })];
    const resource = makeResource('r1', { state: ResourceState.ENRICHED, mediaIds: ['m1'] });
    const store = new FakeMediaStore(media);
    const controlStore = new FakeControlStore();
    // No pinned_resource_ids in control store

    const janitor = new MediaJanitor(
      store,
      new FakeQueryable([resource]),
      cachePolicy(0),
      controlStore,
    );
    const report = await janitor.runPass();

    expect(store.deletedIds).toContain('m1');
    expect(report.skippedPinned).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Suite: video retention
// ---------------------------------------------------------------------------

describe('MediaJanitor — video retention', () => {
  it('skips video blobs when retainVideo=true', async () => {
    const media = [makeMetadata('v1', { sizeBytes: 5000, type: MediaType.VIDEO })];
    const resource = makeVideoResource('r1', ['v1']);
    const store = new FakeMediaStore(media);
    const policy = cachePolicy(0, true); // retainVideo=true

    const janitor = new MediaJanitor(store, new FakeQueryable([resource]), policy);
    const report = await janitor.runPass();

    expect(store.deletedIds).toHaveLength(0);
    expect(report.skippedVideo).toBe(1);
    expect(report.mediaEvicted).toBe(0);
  });

  it('evicts video blobs when retainVideo=false', async () => {
    const media = [makeMetadata('v1', { sizeBytes: 5000, type: MediaType.VIDEO })];
    const resource = makeVideoResource('r1', ['v1']);
    const store = new FakeMediaStore(media);
    const policy = cachePolicy(0, false); // retainVideo=false

    const janitor = new MediaJanitor(store, new FakeQueryable([resource]), policy);
    const report = await janitor.runPass();

    expect(store.deletedIds).toContain('v1');
    expect(report.skippedVideo).toBe(0);
    expect(report.mediaEvicted).toBe(1);
  });

  it('evicts image blobs even when retainVideo=true', async () => {
    // img1 (oldest), vid (middle), img2 (newest) — each 200 bytes; cap=200 → need 400 freed.
    // Eviction order: img1 (evict, 200 freed), vid (skip, retainVideo), img2 (evict, 400 freed).
    const media = [
      makeMetadata('img1', {
        sizeBytes: 200,
        lastAccess: '2024-01-01T00:00:01.000Z',
        type: MediaType.IMAGE,
      }),
      makeMetadata('vid', {
        sizeBytes: 200,
        lastAccess: '2024-01-01T00:00:02.000Z',
        type: MediaType.VIDEO,
      }),
      makeMetadata('img2', {
        sizeBytes: 200,
        lastAccess: '2024-01-01T00:00:03.000Z',
        type: MediaType.IMAGE,
      }),
    ];
    const resources = [
      makeResource('r-img1', { state: ResourceState.ENRICHED, mediaIds: ['img1'] }),
      makeVideoResource('r-vid', ['vid']),
      makeResource('r-img2', { state: ResourceState.ENRICHED, mediaIds: ['img2'] }),
    ];
    const store = new FakeMediaStore(media);
    const policy = cachePolicy(200, true); // retain video; totalBytes=600, cap=200 → need 400

    const janitor = new MediaJanitor(store, new FakeQueryable(resources), policy);
    const report = await janitor.runPass();

    expect(store.deletedIds).toContain('img1');
    expect(store.deletedIds).toContain('img2');
    expect(store.deletedIds).not.toContain('vid');
    expect(report.skippedVideo).toBe(1);
    expect(report.mediaEvicted).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Suite: storage failures
// ---------------------------------------------------------------------------

describe('MediaJanitor — storage failures', () => {
  it('reports completedCleanly=false when statistics() throws', async () => {
    const store = new ThrowingMediaStore();
    const janitor = new MediaJanitor(store, new FakeQueryable([]), cachePolicy(0));

    const report = await janitor.runPass();

    expect(report.completedCleanly).toBe(false);
    expect(report.error).toBeDefined();
  });

  it('reports completedCleanly=false when queryResources throws', async () => {
    // Put 1 byte over cap so we proceed past statistics check
    const store = new FakeMediaStore([makeMetadata('m1', { sizeBytes: 100 })]);
    const janitor = new MediaJanitor(store, new ThrowingQueryable(), cachePolicy(0));

    const report = await janitor.runPass();

    expect(report.completedCleanly).toBe(false);
    expect(report.error).toBeDefined();
  });

  it('isolates per-item delete failure and continues evicting other blobs', async () => {
    const media = [
      makeMetadata('fail', { sizeBytes: 100, lastAccess: '2024-01-01T00:00:01.000Z' }),
      makeMetadata('ok', { sizeBytes: 100, lastAccess: '2024-01-01T00:00:02.000Z' }),
    ];
    const resources = [makeResource('r', { mediaIds: ['fail', 'ok'] })];
    const store = new FakeMediaStore(media);
    store.deleteError = new Error('disk full');

    const janitor = new MediaJanitor(store, new FakeQueryable(resources), cachePolicy(0));
    const report = await janitor.runPass();

    // The pass should complete cleanly despite individual delete errors
    expect(report.completedCleanly).toBe(true);
    // No bytes actually freed because all deletes failed
    expect(report.bytesFreed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Suite: statistics calculation
// ---------------------------------------------------------------------------

describe('MediaJanitor — statistics', () => {
  it('totalBytesBeforeEviction matches statistics() totalBytes', async () => {
    const media = [makeMetadata('a', { sizeBytes: 300 }), makeMetadata('b', { sizeBytes: 200 })];
    const resources = [makeResource('r', { mediaIds: ['a', 'b'] })];
    const store = new FakeMediaStore(media);
    const janitor = new MediaJanitor(store, new FakeQueryable(resources), cachePolicy(0));

    const report = await janitor.runPass();

    expect(report.totalBytesBeforeEviction).toBe(500);
  });

  it('totalBytesAfterEviction reflects bytes freed', async () => {
    const media = [
      makeMetadata('a', { sizeBytes: 200, lastAccess: '2024-01-01T00:00:01.000Z' }),
      makeMetadata('b', { sizeBytes: 200, lastAccess: '2024-01-01T00:00:02.000Z' }),
    ];
    const resources = [makeResource('r', { mediaIds: ['a', 'b'] })];
    const store = new FakeMediaStore(media);
    // cap=200 → free 200 → evict 'a'
    const janitor = new MediaJanitor(store, new FakeQueryable(resources), cachePolicy(200));

    const report = await janitor.runPass();

    expect(report.totalBytesBeforeEviction).toBe(400);
    expect(report.bytesFreed).toBe(200);
    expect(report.totalBytesAfterEviction).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Suite: alarm scheduling
// ---------------------------------------------------------------------------

describe('MediaJanitor — alarm scheduling', () => {
  beforeEach(() => alarmCreateSpy.mockClear());
  afterEach(() => alarmCreateSpy.mockClear());

  it('schedule() calls chrome.alarms.create with the janitor alarm name', () => {
    const janitor = new MediaJanitor(new FakeMediaStore(), new FakeQueryable([]), keepPolicy);
    janitor.schedule(15);

    expect(alarmCreateSpy).toHaveBeenCalledWith(MediaJanitor.ALARM_NAME, {
      delayInMinutes: 15,
    });
  });

  it('handleAlarm() triggers a runPass and reschedules', async () => {
    const janitor = new MediaJanitor(new FakeMediaStore(), new FakeQueryable([]), keepPolicy);

    // We call handleAlarm and give the async chain time to settle
    janitor.handleAlarm();
    // Wait for the microtask queue to drain
    await new Promise((resolve) => setTimeout(resolve, 0));

    // After the pass finishes, a new alarm should be registered
    expect(alarmCreateSpy).toHaveBeenCalledWith(
      MediaJanitor.ALARM_NAME,
      expect.objectContaining({ delayInMinutes: expect.any(Number) }),
    );
  });

  it('handleAlarm() is a no-op if a pass is already in progress', async () => {
    // Block runPass inside statistics() so the first pass stays in-progress.
    // Use cachePolicy(0) so the pass reaches statistics() and does not short-circuit.
    let resolvePass!: () => void;
    class SlowMediaStore extends FakeMediaStore {
      override statistics(): Promise<IMediaStoreStatistics> {
        return new Promise<IMediaStoreStatistics>((r) => {
          resolvePass = () => r({ count: 100, totalBytes: 100, countByType: {}, bytesByType: {} });
        });
      }
    }
    const janitor = new MediaJanitor(new SlowMediaStore(), new FakeQueryable([]), cachePolicy(0));

    alarmCreateSpy.mockClear();
    janitor.handleAlarm(); // starts pass — blocks in statistics()
    // statistics() executor runs synchronously, so resolvePass is now assigned
    janitor.handleAlarm(); // should be ignored (_passInProgress=true)

    // Resolve the first pass
    resolvePass();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // The create alarm should only have been called once (from the first pass completing)
    const callsAfterComplete = alarmCreateSpy.mock.calls.filter(
      ([name]) => name === MediaJanitor.ALARM_NAME,
    );
    expect(callsAfterComplete.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Suite: startup invariants
// ---------------------------------------------------------------------------

describe('MediaJanitor — startup', () => {
  it('exposes a static ALARM_NAME string', () => {
    expect(typeof MediaJanitor.ALARM_NAME).toBe('string');
    expect(MediaJanitor.ALARM_NAME.length).toBeGreaterThan(0);
  });

  it('can be constructed without a controlStore (no pinned checks)', async () => {
    const media = [makeMetadata('m1', { sizeBytes: 1000 })];
    const resource = makeResource('r1', { state: ResourceState.ENRICHED, mediaIds: ['m1'] });
    const store = new FakeMediaStore(media);
    // No controlStore — should not throw
    const janitor = new MediaJanitor(store, new FakeQueryable([resource]), cachePolicy(0));
    const report = await janitor.runPass();
    expect(report.completedCleanly).toBe(true);
    expect(report.skippedPinned).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Suite: deterministic eviction order
// ---------------------------------------------------------------------------

describe('MediaJanitor — deterministic eviction order', () => {
  it('produces the same eviction order across two passes with identical state', async () => {
    const media = [
      makeMetadata('c', { sizeBytes: 100, lastAccess: '2024-01-01T00:00:03.000Z' }),
      makeMetadata('a', { sizeBytes: 100, lastAccess: '2024-01-01T00:00:01.000Z' }),
      makeMetadata('b', { sizeBytes: 100, lastAccess: '2024-01-01T00:00:02.000Z' }),
    ];
    const resources = [makeResource('r', { mediaIds: ['a', 'b', 'c'] })];

    const store1 = new FakeMediaStore(media);
    const store2 = new FakeMediaStore(media);
    const policy = cachePolicy(200);

    const j1 = new MediaJanitor(store1, new FakeQueryable(resources), policy);
    const j2 = new MediaJanitor(store2, new FakeQueryable(resources), policy);

    await j1.runPass();
    await j2.runPass();

    expect(store1.deletedIds).toEqual(store2.deletedIds);
  });
});
