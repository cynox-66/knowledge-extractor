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
  type ISerializer,
  type IExportItem,
  type IExportPart,
  type IExportProgress,
  type IExportRequest,
} from '@knowledge-extractor/types';
import { ExportCoordinator } from '../src/background/export/coordinator.js';
import { ExportWriter } from '../src/background/export/writer.js';
import { createSerializerRegistry } from '../src/background/export/registry.js';
import type { IDownloadGateway } from '../src/background/export/download-gateway.js';

// ---------------------------------------------------------------------------
// Fakes
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
  opts: { state?: ResourceState; mediaIds?: string[] } = {},
): IResource {
  const { state = ResourceState.ENRICHED, mediaIds = [] } = opts;
  return {
    id,
    kind: 'post',
    state,
    source: {
      providerName: 'instagram',
      externalId: id,
      originalUri: `https://example.com/${id}`,
      extractedAt: '2024-01-15T10:00:00.000Z',
    },
    content: [{ type: BlockType.TEXT, value: `content ${id}` }],
    media: mediaIds.map((mid) => ({
      id: mid,
      type: MediaType.IMAGE,
      sourceUri: `https://cdn/${mid}.jpg`,
    })),
    completeness: { thumbnail: true, metadata: true, media: true, ocr: true },
  };
}

function jsonRequest(media: IExportRequest['media'] = 'none'): IExportRequest {
  return { target: ExportTarget.JSON, state: ResourceState.ENRICHED, media };
}

function buildCoordinator(
  resources: IResource[],
  opts: {
    media?: FakeMediaStore;
    store?: StubControlStateStore;
    registry?: Map<ExportTarget, ISerializer>;
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
  const registry = opts.registry ?? createSerializerRegistry();
  const queryable = opts.queryable ?? new InMemoryQueryable(resources);
  const coordinator = new ExportCoordinator(queryable, media, store, registry, writer);
  return { coordinator, gateway, store, media };
}

function ndjsonLines(text: string): string[] {
  return text.split('\n').filter((l) => l.length > 0);
}

// ---------------------------------------------------------------------------
// End-to-end JSON
// ---------------------------------------------------------------------------

describe('ExportCoordinator — JSON end-to-end', () => {
  it('exports every ENRICHED resource as one NDJSON line', async () => {
    const resources = [makeResource('r1'), makeResource('r2'), makeResource('r3')];
    const { coordinator, gateway } = buildCoordinator(resources);

    const result = await coordinator.runExport(jsonRequest());

    expect(result.resourcesExported).toBe(3);
    expect(result.target).toBe(ExportTarget.JSON);
    expect(gateway.deliveries).toHaveLength(1);

    const text = await gateway.deliveries[0].content.text();
    const lines = ndjsonLines(text);
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => JSON.parse(l).resourceId)).toEqual(['r1', 'r2', 'r3']);
    expect(gateway.deliveries[0].filename).toMatch(/\.ndjson$/);
  });

  it('only exports resources in the requested state', async () => {
    const resources = [
      makeResource('e1', { state: ResourceState.ENRICHED }),
      makeResource('h1', { state: ResourceState.HYDRATED }),
      makeResource('e2', { state: ResourceState.ENRICHED }),
    ];
    const { coordinator, gateway } = buildCoordinator(resources);

    const result = await coordinator.runExport(jsonRequest());

    expect(result.resourcesExported).toBe(2);
    const lines = ndjsonLines(await gateway.deliveries[0].content.text());
    expect(lines.map((l) => JSON.parse(l).resourceId)).toEqual(['e1', 'e2']);
  });
});

// ---------------------------------------------------------------------------
// Paging
// ---------------------------------------------------------------------------

describe('ExportCoordinator — paging', () => {
  it('exports across multiple pages with no duplicates (PAGE_SIZE=20)', async () => {
    const resources = Array.from({ length: 55 }, (_, i) =>
      makeResource(`r${String(i).padStart(3, '0')}`),
    );
    const { coordinator, gateway } = buildCoordinator(resources);

    const result = await coordinator.runExport(jsonRequest());

    expect(result.resourcesExported).toBe(55);
    const ids = ndjsonLines(await gateway.deliveries[0].content.text()).map(
      (l) => JSON.parse(l).resourceId,
    );
    expect(ids).toHaveLength(55);
    expect(new Set(ids).size).toBe(55);
  });
});

// ---------------------------------------------------------------------------
// Serializer selection + Markdown ZIP
// ---------------------------------------------------------------------------

describe('ExportCoordinator — serializer selection', () => {
  it('produces a ZIP for the Markdown target', async () => {
    const resources = [makeResource('r1'), makeResource('r2')];
    const { coordinator, gateway } = buildCoordinator(resources);

    const result = await coordinator.runExport({
      target: ExportTarget.MARKDOWN,
      state: ResourceState.ENRICHED,
      media: 'none',
    });

    expect(gateway.deliveries[0].content.type).toBe('application/zip');
    expect(gateway.deliveries[0].filename).toMatch(/\.zip$/);
    expect(result.resourcesExported).toBe(2);
  });

  it('rejects a target that has no registered serializer', () => {
    const { coordinator } = buildCoordinator([makeResource('r1')]);
    const start = coordinator.start({
      target: 'unknown-format' as ExportTarget,
      state: ResourceState.ENRICHED,
      media: 'none',
    });
    expect(start.accepted).toBe(false);
    expect(start.reason).toMatch(/serializer/i);
  });
});

// ---------------------------------------------------------------------------
// Media presence / download orchestration
// ---------------------------------------------------------------------------

describe('ExportCoordinator — media resolution', () => {
  it('includes present blobs as binary parts under link-local', async () => {
    const resources = [makeResource('r1', { mediaIds: ['m1', 'm2'] })];
    const media = new FakeMediaStore({ m1: new Uint8Array([1, 2, 3]), m2: new Uint8Array([4]) });
    const { coordinator } = buildCoordinator(resources, { media });

    const result = await coordinator.runExport({
      target: ExportTarget.MARKDOWN,
      state: ResourceState.ENRICHED,
      media: 'link-local',
    });

    expect(result.mediaIncluded).toBe(2);
    expect(result.mediaMissing).toBe(0);
  });

  it('counts present-at-projection / absent-at-write blobs as missing', async () => {
    // exists() is true (present at projection) but get() returns null (evicted).
    const resources = [makeResource('r1', { mediaIds: ['m1'] })];
    const media = new FakeMediaStore();
    vi.spyOn(media, 'exists').mockResolvedValue(true);
    vi.spyOn(media, 'get').mockResolvedValue(null);
    const { coordinator } = buildCoordinator(resources, { media });

    const result = await coordinator.runExport({
      target: ExportTarget.MARKDOWN,
      state: ResourceState.ENRICHED,
      media: 'link-local',
    });

    expect(result.mediaIncluded).toBe(0);
    expect(result.mediaMissing).toBe(1);
  });

  it('never probes media presence under inclusion "none"', async () => {
    const resources = [makeResource('r1', { mediaIds: ['m1'] })];
    const media = new FakeMediaStore({ m1: new Uint8Array([1]) });
    const existsSpy = vi.spyOn(media, 'exists');
    const { coordinator, gateway } = buildCoordinator(resources, { media });

    await coordinator.runExport({
      target: ExportTarget.MARKDOWN,
      state: ResourceState.ENRICHED,
      media: 'none',
    });

    expect(existsSpy).not.toHaveBeenCalled();
    expect(gateway.deliveries).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Progress persistence
// ---------------------------------------------------------------------------

describe('ExportCoordinator — progress persistence', () => {
  it('persists a done=true progress record after completion', async () => {
    const resources = [makeResource('r1'), makeResource('r2')];
    const { coordinator, store } = buildCoordinator(resources);

    await coordinator.runExport(jsonRequest());

    const progress = (await store.getCrawlState('export_progress')) as IExportProgress;
    expect(progress.done).toBe(true);
    expect(progress.resourcesWritten).toBe(2);
    expect(progress.target).toBe(ExportTarget.JSON);
  });

  it('checkpoints a cursor after each page during a multi-page export', async () => {
    const resources = Array.from({ length: 45 }, (_, i) =>
      makeResource(`r${String(i).padStart(3, '0')}`),
    );
    const store = new StubControlStateStore();
    const saveSpy = vi.spyOn(store, 'saveCrawlState');
    const { coordinator } = buildCoordinator(resources, { store });

    await coordinator.runExport(jsonRequest());

    // Progress saved 3 times (pages: 20+20+5) with an interim cursor.
    const progressSaves = saveSpy.mock.calls.filter((c) => c[0] === 'export_progress');
    expect(progressSaves.length).toBeGreaterThanOrEqual(3);
    const firstPage = progressSaves[0][1] as IExportProgress;
    expect(firstPage.cursor).toBe('r019');
    expect(firstPage.done).toBe(false);
  });

  it('exposes progress via getProgress()', async () => {
    const { coordinator } = buildCoordinator([makeResource('r1')]);
    await coordinator.runExport(jsonRequest());
    const progress = await coordinator.getProgress();
    expect(progress?.done).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Duplicate request protection
// ---------------------------------------------------------------------------

describe('ExportCoordinator — duplicate protection', () => {
  it('rejects a second start() while an export is running', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const queryable: IResourceQueryable = {
      async queryResources(): Promise<IEnrichmentSelection> {
        await gate;
        return { items: [], hasMore: false };
      },
    };
    const { coordinator } = buildCoordinator([], { queryable });

    const inFlight = coordinator.runExport(jsonRequest());
    await new Promise((r) => setTimeout(r, 10)); // let the run latch _activeRun

    const second = coordinator.start(jsonRequest());
    expect(second.accepted).toBe(false);
    expect(second.reason).toMatch(/in progress/i);

    release();
    await inFlight;

    // After completion a new export is accepted again.
    const third = coordinator.start(jsonRequest());
    expect(third.accepted).toBe(true);
  });

  it('runExport throws when called while a run is active', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const queryable: IResourceQueryable = {
      async queryResources(): Promise<IEnrichmentSelection> {
        await gate;
        return { items: [], hasMore: false };
      },
    };
    const { coordinator } = buildCoordinator([], { queryable });

    const inFlight = coordinator.runExport(jsonRequest());
    await new Promise((r) => setTimeout(r, 10));

    await expect(coordinator.runExport(jsonRequest())).rejects.toThrow(/in progress/i);

    release();
    await inFlight;
  });
});

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

describe('ExportCoordinator — cancellation', () => {
  it('aborts before delivery and clears persisted state when cancelled mid-run', async () => {
    const resources = Array.from({ length: 30 }, (_, i) =>
      makeResource(`r${String(i).padStart(3, '0')}`),
    );
    // Cancel as soon as the first page has been queried.
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
    const built = buildCoordinator(resources, { queryable });
    coordinatorRef = built.coordinator;

    const result = await built.coordinator.runExport(jsonRequest());

    // Cancelled after page 1: no artifact delivered, state cleared.
    expect(built.gateway.deliveries).toHaveLength(0);
    expect(await built.store.getCrawlState('export_progress')).toBeNull();
    expect(await built.store.getCrawlState('export_request')).toBeNull();
    expect(result.resourcesExported).toBe(20); // first page was processed
  });
});

// ---------------------------------------------------------------------------
// Failure recovery (per-item isolation)
// ---------------------------------------------------------------------------

class PoisonSerializer implements ISerializer {
  readonly target = ExportTarget.JSON;
  constructor(private readonly badId: string) {}
  serializeItem(item: IExportItem): IExportPart[] {
    if (item.resourceId === this.badId) throw new Error('serialize boom');
    return [
      { path: 'export.ndjson', kind: 'text', text: JSON.stringify({ id: item.resourceId }) + '\n' },
    ];
  }
}

describe('ExportCoordinator — failure recovery', () => {
  it('isolates a failing resource and exports the rest', async () => {
    const resources = [makeResource('r1'), makeResource('r2'), makeResource('r3')];
    const registry = new Map<ExportTarget, ISerializer>([
      [ExportTarget.JSON, new PoisonSerializer('r2')],
    ]);
    const { coordinator, gateway } = buildCoordinator(resources, { registry });

    const result = await coordinator.runExport(jsonRequest());

    expect(result.resourcesExported).toBe(2); // r2 failed, r1 + r3 succeeded
    const ids = ndjsonLines(await gateway.deliveries[0].content.text()).map(
      (l) => JSON.parse(l).id,
    );
    expect(ids).toEqual(['r1', 'r3']);
  });
});

// ---------------------------------------------------------------------------
// Resumability after simulated worker eviction
// ---------------------------------------------------------------------------

describe('ExportCoordinator — resumability', () => {
  it('resume() re-drives an interrupted export to a complete artifact', async () => {
    const resources = Array.from({ length: 15 }, (_, i) =>
      makeResource(`r${String(i).padStart(3, '0')}`),
    );
    const store = new StubControlStateStore();
    // Simulate an export interrupted by worker eviction: progress + request
    // persisted, done=false, in-memory buffer lost (fresh coordinator instance).
    await store.saveCrawlState('export_progress', {
      requestId: 'rq-1',
      target: ExportTarget.JSON,
      resourcesWritten: 5,
      mediaWritten: 0,
      startedAt: '2024-01-15T10:00:00.000Z',
      updatedAt: '2024-01-15T10:00:01.000Z',
      done: false,
      cursor: 'r004',
    } satisfies IExportProgress);
    await store.saveCrawlState('export_request', jsonRequest());

    const { coordinator, gateway } = buildCoordinator(resources, { store });
    await coordinator.resume();

    // A single complete artifact is delivered (all 15 resources, not just 10).
    expect(gateway.deliveries).toHaveLength(1);
    const lines = ndjsonLines(await gateway.deliveries[0].content.text());
    expect(lines).toHaveLength(15);

    const progress = (await store.getCrawlState('export_progress')) as IExportProgress;
    expect(progress.done).toBe(true);
    expect(progress.requestId).toBe('rq-1'); // same request id preserved
  });

  it('resume() is a no-op when nothing is pending', async () => {
    const { coordinator, gateway } = buildCoordinator([makeResource('r1')]);
    await coordinator.resume();
    expect(gateway.deliveries).toHaveLength(0);
  });

  it('resume() is a no-op when the persisted export is already done', async () => {
    const store = new StubControlStateStore();
    await store.saveCrawlState('export_progress', {
      requestId: 'rq-2',
      target: ExportTarget.JSON,
      resourcesWritten: 3,
      mediaWritten: 0,
      startedAt: '2024-01-15T10:00:00.000Z',
      updatedAt: '2024-01-15T10:00:01.000Z',
      done: true,
    } satisfies IExportProgress);
    const { coordinator, gateway } = buildCoordinator([makeResource('r1')], { store });

    await coordinator.resume();
    expect(gateway.deliveries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// MV3 watchdog lifecycle
// ---------------------------------------------------------------------------

describe('ExportCoordinator — watchdog lifecycle', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('arms the watchdog alarm during a run and disarms it on completion', async () => {
    const alarms = { create: vi.fn(), clear: vi.fn().mockResolvedValue(true) };
    vi.stubGlobal('chrome', { alarms });

    const { coordinator } = buildCoordinator([makeResource('r1')]);
    await coordinator.runExport(jsonRequest());

    expect(alarms.create).toHaveBeenCalledWith(ExportCoordinator.ALARM_NAME, {
      delayInMinutes: 1,
    });
    expect(alarms.clear).toHaveBeenCalledWith(ExportCoordinator.ALARM_NAME);
  });

  it('handleAlarm() triggers resume of an interrupted export', async () => {
    const alarms = { create: vi.fn(), clear: vi.fn().mockResolvedValue(true) };
    vi.stubGlobal('chrome', { alarms });

    const resources = [makeResource('r1'), makeResource('r2')];
    const store = new StubControlStateStore();
    await store.saveCrawlState('export_progress', {
      requestId: 'rq-3',
      target: ExportTarget.JSON,
      resourcesWritten: 0,
      mediaWritten: 0,
      startedAt: '2024-01-15T10:00:00.000Z',
      updatedAt: '2024-01-15T10:00:00.000Z',
      done: false,
    } satisfies IExportProgress);
    await store.saveCrawlState('export_request', jsonRequest());

    const { coordinator, gateway } = buildCoordinator(resources, { store });
    coordinator.handleAlarm();

    await vi.waitFor(() => expect(gateway.deliveries).toHaveLength(1));
  });
});
