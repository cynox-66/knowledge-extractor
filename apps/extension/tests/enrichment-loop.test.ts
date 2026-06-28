import { describe, it, expect, vi } from 'vitest';
import {
  IResource,
  IResourceQueryable,
  IResourceQuery,
  IEnrichmentSelection,
  IMediaStore,
  IMediaMetadata,
  IMediaStoreStatistics,
  ICleanupResult,
  IEnrichmentWorkItem,
  ResourceState,
  MediaType,
  BlockType,
} from '@knowledge-extractor/types';
import { EnrichmentLoop } from '../src/background/enrichment-loop.js';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

/**
 * Minimal in-memory IResourceQueryable. Resources are pre-loaded; queries
 * filter by state and paginate by cursor (primary-key position, same semantics
 * as IndexedDbStorageEngine).
 */
class InMemoryQueryable implements IResourceQueryable {
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
      ...(hasMore ? { nextCursor: items[items.length - 1].id } : {}),
    };
  }
}

/**
 * Queryable that throws on the first call (tests error-capture behaviour).
 */
class ThrowingQueryable implements IResourceQueryable {
  queryResources(): Promise<IEnrichmentSelection> {
    return Promise.reject(new Error('storage unavailable'));
  }
}

/**
 * Minimal IMediaStore stub — only getMetadata has real logic.
 */
class StubMediaStore implements IMediaStore {
  private readonly meta: Map<string, IMediaMetadata>;

  constructor(entries: IMediaMetadata[] = []) {
    this.meta = new Map(entries.map((m) => [m.id, m]));
  }

  getMetadata(id: string): Promise<IMediaMetadata | null> {
    return Promise.resolve(this.meta.get(id) ?? null);
  }

  put(): Promise<IMediaMetadata> {
    throw new Error('not implemented');
  }
  get(): Promise<Blob | null> {
    return Promise.resolve(null);
  }
  exists(): Promise<boolean> {
    return Promise.resolve(false);
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

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeResource(
  id: string,
  opts: {
    state?: ResourceState;
    mediaIds?: string[];
    mediaComplete?: boolean;
  } = {},
): IResource {
  const { state = ResourceState.HYDRATED, mediaIds = [], mediaComplete = true } = opts;
  return {
    id,
    kind: 'test-post',
    state,
    source: {
      providerName: 'test',
      externalId: id,
      originalUri: `https://example.com/${id}`,
      extractedAt: new Date().toISOString(),
    },
    content: [{ type: BlockType.TEXT, value: `content for ${id}` }],
    media: mediaIds.map((mid) => ({
      id: mid,
      type: MediaType.IMAGE,
      sourceUri: `https://cdn/${mid}.jpg`,
    })),
    completeness: { thumbnail: true, metadata: true, media: mediaComplete, ocr: false },
  };
}

function makeMetadata(id: string): IMediaMetadata {
  return {
    id,
    type: MediaType.IMAGE,
    mimeType: 'image/jpeg',
    sizeBytes: 1024,
    hash: `hash-${id}`,
    storagePath: `media/images/${id}`,
    state: 'complete',
    createdAt: new Date().toISOString(),
    lastAccess: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Suites
// ---------------------------------------------------------------------------

describe('EnrichmentLoop — empty store', () => {
  it('returns a clean report with zero counts', async () => {
    const loop = new EnrichmentLoop(new InMemoryQueryable([]), new StubMediaStore());
    const report = await loop.runPass();

    expect(report.completedCleanly).toBe(true);
    expect(report.resourcesEnumerated).toBe(0);
    expect(report.resourcesReady).toBe(0);
    expect(report.resourcesWithMissingMedia).toBe(0);
    expect(report.resourcesSkipped).toBe(0);
    expect(report.resourcesFailed).toBe(0);
    expect(report.error).toBeUndefined();
  });

  it('does not call onWorkItem when the store is empty', async () => {
    const handler = vi.fn();
    const loop = new EnrichmentLoop(new InMemoryQueryable([]), new StubMediaStore(), handler);
    await loop.runPass();
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('EnrichmentLoop — state filtering', () => {
  it('only enumerates HYDRATED resources, ignoring other states', async () => {
    const resources = [
      makeResource('h1', { state: ResourceState.HYDRATED }),
      makeResource('e1', { state: ResourceState.EXTRACTED }),
      makeResource('h2', { state: ResourceState.HYDRATED }),
      makeResource('n1', { state: ResourceState.ENRICHED }),
    ];
    const loop = new EnrichmentLoop(new InMemoryQueryable(resources), new StubMediaStore());
    const report = await loop.runPass();

    expect(report.resourcesEnumerated).toBe(2);
  });
});

describe('EnrichmentLoop — skip condition', () => {
  it('skips resources with completeness.media = false', async () => {
    const resources = [
      makeResource('s1', { mediaIds: ['m1'], mediaComplete: false }),
      makeResource('s2', { mediaIds: ['m2'], mediaComplete: false }),
    ];
    const mediaStore = new StubMediaStore([makeMetadata('m1'), makeMetadata('m2')]);
    const handler = vi.fn();
    const loop = new EnrichmentLoop(new InMemoryQueryable(resources), mediaStore, handler);
    const report = await loop.runPass();

    expect(report.resourcesEnumerated).toBe(2);
    expect(report.resourcesSkipped).toBe(2);
    expect(report.resourcesReady).toBe(0);
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not skip resources with completeness.media = true', async () => {
    const resources = [makeResource('r1', { mediaIds: ['m1'], mediaComplete: true })];
    const mediaStore = new StubMediaStore([makeMetadata('m1')]);
    const handler = vi.fn();
    const loop = new EnrichmentLoop(new InMemoryQueryable(resources), mediaStore, handler);
    const report = await loop.runPass();

    expect(report.resourcesSkipped).toBe(0);
    expect(report.resourcesReady).toBe(1);
    expect(handler).toHaveBeenCalledOnce();
  });
});

describe('EnrichmentLoop — reconciliation: all media present', () => {
  it('counts resource as ready when all blobs resolve', async () => {
    const resources = [makeResource('r1', { mediaIds: ['m1', 'm2'] })];
    const mediaStore = new StubMediaStore([makeMetadata('m1'), makeMetadata('m2')]);
    const loop = new EnrichmentLoop(new InMemoryQueryable(resources), mediaStore);
    const report = await loop.runPass();

    expect(report.resourcesReady).toBe(1);
    expect(report.resourcesWithMissingMedia).toBe(0);
  });

  it('passes fully resolved IEnrichmentWorkItem to onWorkItem', async () => {
    const resources = [makeResource('r1', { mediaIds: ['m1'] })];
    const meta = makeMetadata('m1');
    const mediaStore = new StubMediaStore([meta]);

    const received: IEnrichmentWorkItem[] = [];
    const loop = new EnrichmentLoop(new InMemoryQueryable(resources), mediaStore, async (item) => {
      received.push(item);
    });
    await loop.runPass();

    expect(received).toHaveLength(1);
    expect(received[0].resource.id).toBe('r1');
    expect(received[0].resolvedMedia['m1']).toEqual(meta);
  });
});

describe('EnrichmentLoop — reconciliation: missing blobs', () => {
  it('counts resource as resourcesWithMissingMedia when any blob is absent', async () => {
    const resources = [makeResource('r1', { mediaIds: ['m1', 'm2'] })];
    // Only m1 is in the store; m2 is absent.
    const mediaStore = new StubMediaStore([makeMetadata('m1')]);
    const loop = new EnrichmentLoop(new InMemoryQueryable(resources), mediaStore);
    const report = await loop.runPass();

    expect(report.resourcesReady).toBe(0);
    expect(report.resourcesWithMissingMedia).toBe(1);
    expect(report.resourcesEnumerated).toBe(1);
  });

  it('still calls onWorkItem when blobs are partially missing', async () => {
    const resources = [makeResource('r1', { mediaIds: ['m1', 'm2'] })];
    const mediaStore = new StubMediaStore([makeMetadata('m1')]); // m2 absent

    const received: IEnrichmentWorkItem[] = [];
    const loop = new EnrichmentLoop(new InMemoryQueryable(resources), mediaStore, async (item) => {
      received.push(item);
    });
    await loop.runPass();

    expect(received).toHaveLength(1);
    expect(received[0].resolvedMedia['m1']).toBeDefined();
    expect(received[0].resolvedMedia['m2']).toBeUndefined();
  });

  it('counts as ready when all blobs are absent but media array is empty', async () => {
    // A resource with no media items is trivially fully resolved.
    const resources = [makeResource('r1', { mediaIds: [] })];
    const loop = new EnrichmentLoop(new InMemoryQueryable(resources), new StubMediaStore());
    const report = await loop.runPass();

    expect(report.resourcesReady).toBe(1);
    expect(report.resourcesWithMissingMedia).toBe(0);
  });

  it('emits work item with empty resolvedMedia for media-less resources', async () => {
    const resources = [makeResource('r1', { mediaIds: [] })];
    const received: IEnrichmentWorkItem[] = [];
    const loop = new EnrichmentLoop(
      new InMemoryQueryable(resources),
      new StubMediaStore(),
      async (item) => {
        received.push(item);
      },
    );
    await loop.runPass();

    expect(received).toHaveLength(1);
    expect(Object.keys(received[0].resolvedMedia)).toHaveLength(0);
  });
});

describe('EnrichmentLoop — pagination', () => {
  it('enumerates all resources across multiple pages', async () => {
    // Force multiple pages by using a small PAGE_SIZE via many resources.
    // The EnrichmentLoop uses PAGE_SIZE=20 internally; create 55 resources.
    const resources = Array.from({ length: 55 }, (_, i) =>
      makeResource(`r${String(i).padStart(3, '0')}`, { mediaIds: [] }),
    );
    const received: IEnrichmentWorkItem[] = [];
    const loop = new EnrichmentLoop(
      new InMemoryQueryable(resources),
      new StubMediaStore(),
      async (item) => {
        received.push(item);
      },
    );
    const report = await loop.runPass();

    expect(report.resourcesEnumerated).toBe(55);
    expect(report.resourcesReady).toBe(55);
    expect(received).toHaveLength(55);
    // No duplicates.
    expect(new Set(received.map((i) => i.resource.id)).size).toBe(55);
    expect(report.completedCleanly).toBe(true);
  });

  it('enumerates exactly the right resources when mixed with other states', async () => {
    const resources = [
      ...Array.from({ length: 25 }, (_, i) =>
        makeResource(`h${i}`, { state: ResourceState.HYDRATED, mediaIds: [] }),
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        makeResource(`e${i}`, { state: ResourceState.EXTRACTED, mediaIds: [] }),
      ),
    ];
    const received: IEnrichmentWorkItem[] = [];
    const loop = new EnrichmentLoop(
      new InMemoryQueryable(resources),
      new StubMediaStore(),
      async (item) => {
        received.push(item);
      },
    );
    const report = await loop.runPass();

    expect(report.resourcesEnumerated).toBe(25);
    expect(received.every((i) => i.resource.state === ResourceState.HYDRATED)).toBe(true);
  });
});

describe('EnrichmentLoop — mixed report counters', () => {
  it('correctly partitions ready / missingMedia / skipped in one pass', async () => {
    const resources = [
      // Ready: all blobs present
      makeResource('ready1', { mediaIds: ['m_ready'] }),
      // Missing: blob absent
      makeResource('missing1', { mediaIds: ['m_missing'] }),
      // Skipped: media capture incomplete
      makeResource('skipped1', { mediaIds: ['m_skip'], mediaComplete: false }),
    ];
    const mediaStore = new StubMediaStore([makeMetadata('m_ready')]);
    const loop = new EnrichmentLoop(new InMemoryQueryable(resources), mediaStore);
    const report = await loop.runPass();

    expect(report.resourcesEnumerated).toBe(3);
    expect(report.resourcesReady).toBe(1);
    expect(report.resourcesWithMissingMedia).toBe(1);
    expect(report.resourcesSkipped).toBe(1);
    expect(report.completedCleanly).toBe(true);
  });
});

describe('EnrichmentLoop — report timestamps', () => {
  it('startedAt and completedAt are valid ISO 8601 strings', async () => {
    const loop = new EnrichmentLoop(new InMemoryQueryable([]), new StubMediaStore());
    const report = await loop.runPass();

    expect(() => new Date(report.startedAt)).not.toThrow();
    expect(() => new Date(report.completedAt)).not.toThrow();
    expect(new Date(report.completedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(report.startedAt).getTime(),
    );
  });
});

describe('EnrichmentLoop — error handling', () => {
  it('captures storage errors into the report and does not throw', async () => {
    const loop = new EnrichmentLoop(new ThrowingQueryable(), new StubMediaStore());
    const report = await loop.runPass();

    expect(report.completedCleanly).toBe(false);
    expect(report.error).toBe('storage unavailable');
  });

  it('captures onWorkItem errors into resourcesFailed without aborting the pass', async () => {
    const resources = [makeResource('r1', { mediaIds: [] })];
    const loop = new EnrichmentLoop(
      new InMemoryQueryable(resources),
      new StubMediaStore(),
      async () => {
        throw new Error('downstream failure');
      },
    );
    const report = await loop.runPass();

    // Per-item isolation: the pass completes cleanly even though the handler threw.
    expect(report.completedCleanly).toBe(true);
    expect(report.resourcesFailed).toBe(1);
    expect(report.resourcesReady).toBe(0);
    expect(report.error).toBeUndefined();
  });

  it('populates error field only when completedCleanly is false', async () => {
    const loop = new EnrichmentLoop(new InMemoryQueryable([]), new StubMediaStore());
    const report = await loop.runPass();

    // A clean run must not have the error key set at all (exactOptionalPropertyTypes).
    expect('error' in report).toBe(false);
  });
});

describe('EnrichmentLoop — per-item error isolation', () => {
  it('continues processing remaining items after one handler failure', async () => {
    const resources = [
      makeResource('fail', { mediaIds: [] }),
      makeResource('ok1', { mediaIds: [] }),
      makeResource('ok2', { mediaIds: [] }),
    ];
    const delivered: string[] = [];
    const loop = new EnrichmentLoop(
      new InMemoryQueryable(resources),
      new StubMediaStore(),
      async (item) => {
        if (item.resource.id === 'fail') throw new Error('handler error');
        delivered.push(item.resource.id);
      },
    );
    const report = await loop.runPass();

    expect(report.completedCleanly).toBe(true);
    expect(report.resourcesEnumerated).toBe(3);
    expect(report.resourcesFailed).toBe(1);
    expect(report.resourcesReady).toBe(2);
    expect(delivered).toEqual(['ok1', 'ok2']);
  });

  it('satisfies the counter invariant: enumerated = ready + missing + skipped + failed', async () => {
    const resources = [
      makeResource('ready1', { mediaIds: ['m1'] }),
      makeResource('missing1', { mediaIds: ['m2'] }),
      makeResource('skipped1', { mediaIds: [], mediaComplete: false }),
      makeResource('fail1', { mediaIds: [] }),
    ];
    const mediaStore = new StubMediaStore([makeMetadata('m1')]);
    const loop = new EnrichmentLoop(new InMemoryQueryable(resources), mediaStore, async (item) => {
      if (item.resource.id === 'fail1') throw new Error('boom');
    });
    const report = await loop.runPass();

    expect(report.resourcesEnumerated).toBe(4);
    expect(
      report.resourcesReady +
        report.resourcesWithMissingMedia +
        report.resourcesSkipped +
        report.resourcesFailed,
    ).toBe(report.resourcesEnumerated);
  });
});

describe('EnrichmentLoop — onWorkItem ordering', () => {
  it('delivers work items in the order resources appear in storage', async () => {
    const ids = ['alpha', 'beta', 'gamma', 'delta'];
    const resources = ids.map((id) => makeResource(id, { mediaIds: [] }));
    const delivered: string[] = [];
    const loop = new EnrichmentLoop(
      new InMemoryQueryable(resources),
      new StubMediaStore(),
      async (item) => {
        delivered.push(item.resource.id);
      },
    );
    await loop.runPass();

    expect(delivered).toEqual(ids);
  });
});
