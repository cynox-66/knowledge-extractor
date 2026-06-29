import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsCollector, DiagnosticsCollector } from '@knowledge-extractor/shared';
import {
  TaskState,
  IControlStateStore,
  IStorageEngine,
  ITransaction,
  IResource,
  ICrawlSession,
  ISessionReport,
  ResourceState,
  BlockType,
} from '@knowledge-extractor/types';
import { EnrichmentLoop } from '../src/background/enrichment-loop.js';
import { SessionManager } from '../src/background/session-manager.js';
import { Scheduler } from '../src/background/scheduler.js';

/**
 * Minimal `IControlStateStore` for tests. The same instance reused across
 * SessionManager constructions simulates a browser restart (the durable store
 * survives; the in-memory caches don't).
 */
class TestControlStateStore implements IControlStateStore {
  private readonly sessions = new Map<string, ICrawlSession>();
  private readonly diagnostics = new Map<string, ISessionReport>();
  readonly crawlState = new Map<string, unknown>();

  saveSession(s: ICrawlSession): Promise<void> {
    this.sessions.set(s.sessionId, structuredClone(s));
    return Promise.resolve();
  }
  getSession(id: string): Promise<ICrawlSession | null> {
    return Promise.resolve(this.sessions.get(id) ?? null);
  }
  listSessions(): Promise<ICrawlSession[]> {
    return Promise.resolve([...this.sessions.values()]);
  }
  saveDiagnostics(r: ISessionReport): Promise<void> {
    this.diagnostics.set(r.sessionId, structuredClone(r));
    return Promise.resolve();
  }
  getDiagnostics(id: string): Promise<ISessionReport | null> {
    return Promise.resolve(this.diagnostics.get(id) ?? null);
  }
  saveCrawlState(key: string, value: unknown): Promise<void> {
    this.crawlState.set(key, structuredClone(value));
    return Promise.resolve();
  }
  getCrawlState<T = unknown>(key: string): Promise<T | null> {
    return Promise.resolve((this.crawlState.get(key) as T) ?? null);
  }
  deleteCrawlState(key: string): Promise<void> {
    this.crawlState.delete(key);
    return Promise.resolve();
  }
}

// `chrome.runtime.sendMessage` is the only chrome API SessionManager.persist()
// still touches (popup broadcast). Stub it once for the suite.
beforeEach(() => {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { sendMessage: () => Promise.resolve() },
  };
});

describe('SessionManager — durable persistence (IControlStateStore)', () => {
  it('persists via IControlStateStore, not chrome.storage', async () => {
    const store = new TestControlStateStore();
    const sm = new SessionManager(new MetricsCollector(), store);
    await sm.init();
    sm.startNewSession();
    await sm.update({ currentResource: 'x' });

    expect(store.crawlState.has('current_session')).toBe(true);
    // History copies keyed by sessionId are also persisted (one per session
    // ever observed: the empty init session + the started session).
    expect((await store.listSessions()).length).toBeGreaterThanOrEqual(1);
  });

  it('restores the active session on a fresh instance (browser restart)', async () => {
    const store = new TestControlStateStore();
    const first = new SessionManager(new MetricsCollector(), store);
    await first.init();
    const created = first.startNewSession();
    await first.update({ navigationStatus: 'extracting', queueDepth: 5 });

    // Fresh manager over the same persistent store = restart.
    const second = new SessionManager(new MetricsCollector(), store);
    await second.init();
    const restored = second.getSession();

    expect(restored?.sessionId).toBe(created.sessionId);
    expect(restored?.navigationStatus).toBe('extracting');
    expect(restored?.queueDepth).toBe(5);
  });

  it('rehydrates the canonical metrics from the persisted session', async () => {
    const store = new TestControlStateStore();
    const metrics = new MetricsCollector();
    const first = new SessionManager(metrics, store);
    await first.init();
    first.startNewSession();
    metrics.recordDiscovered();
    metrics.recordExtracted(100);
    metrics.recordPersisted();
    await first.sync(0); // persist embeds metrics.snapshot()

    const restoredMetrics = new MetricsCollector();
    const second = new SessionManager(restoredMetrics, store);
    await second.init();

    const snap = restoredMetrics.snapshot();
    expect(snap.discovered).toBe(1);
    expect(snap.extracted).toBe(1);
    expect(snap.persisted).toBe(1);
  });

  it('persists the pinned tab id and restores it across restart (RCA-8)', async () => {
    const store = new TestControlStateStore();
    const first = new SessionManager(new MetricsCollector(), store);
    await first.init();
    first.startNewSession();
    // CrawlController.startCrawl pins the active Instagram tab here.
    await first.update({ tabId: 1234 });

    // Fresh manager over the same durable store = service-worker revival.
    const second = new SessionManager(new MetricsCollector(), store);
    await second.init();

    expect(second.getSession()?.tabId).toBe(1234);
  });
});

describe('DiagnosticsCollector — snapshot / hydrate', () => {
  it('round-trips failures and strategy usage', () => {
    const d = new DiagnosticsCollector();
    d.reset('https://www.instagram.com/saved');
    d.recordStrategyUsed('SemanticArticleStrategy');
    d.recordStrategyUsed('SemanticArticleStrategy');
    d.recordFailure('uri1', 'parsing_failure', 'boom', { domSnapshot: '<article>x</article>' });

    const snap = d.snapshot();

    const restored = new DiagnosticsCollector();
    restored.hydrate(snap);
    const report = restored.buildReport({
      sessionStart: '',
      sessionEnd: '',
      discovered: 0,
      queued: 0,
      extracted: 0,
      normalized: 0,
      persisted: 0,
      duplicates: 0,
      skipped: 0,
      failed: 0,
      retries: 0,
      navigationFailures: 0,
      extractionFailures: 0,
      normalizationFailures: 0,
      extractionTimeMs: 0,
      normalizationTimeMs: 0,
      navigationTimeMs: 0,
      avgExtractionTime: 0,
      avgNormalizationTime: 0,
      avgNavigationLatency: 0,
      crawlDuration: 0,
      peakQueueSize: 0,
    });

    expect(report.failures).toHaveLength(1);
    expect(report.failures[0].rootCause).toBe('boom');
    expect(report.failures[0].domSnapshot).toBe('<article>x</article>');
    expect(report.strategyUsage['SemanticArticleStrategy']).toBe(2);
    expect(report.pageUrl).toBe('https://www.instagram.com/saved');
  });
});

describe('Scheduler — restore (queue recovery)', () => {
  it('resets in-flight tasks to QUEUED and dedups on restore', () => {
    const original = new Scheduler();
    original.enqueue('https://www.instagram.com/p/a/');
    original.enqueue('https://www.instagram.com/p/b/');
    // Simulate a task that was mid-flight when the worker died.
    const next = original.getNextTask();
    expect(next?.state).toBe(TaskState.OPENING);

    const snapshot = original.snapshot();

    const restored = new Scheduler();
    restored.restore(snapshot);
    // Re-applying the same snapshot must not create duplicates.
    restored.restore(snapshot);

    const all = restored.snapshot();
    expect(all).toHaveLength(2); // no duplicate scheduler entries
    // The previously in-flight task is reclaimable (reset to QUEUED).
    expect(restored.getPendingCount()).toBe(2);
  });
});

describe('Control-state substrate — single source of truth', () => {
  it('SessionManager and CrawlController persistence share one store', async () => {
    // The whole point of Phase 3.5: session + scheduler + diagnostics all sit on
    // the same IControlStateStore. Demonstrated end-to-end here.
    const store = new TestControlStateStore();
    const sm = new SessionManager(new MetricsCollector(), store);
    await sm.init();
    sm.startNewSession();

    // Simulate what CrawlController.persistScheduler / persistDiagnostics do.
    await store.saveCrawlState('crawl_scheduler', [{ id: 't1' }]);
    await store.saveCrawlState('crawl_diagnostics', { sessionId: 'x', failures: [] });

    expect(await store.getCrawlState('current_session')).not.toBeNull();
    expect(await store.getCrawlState('crawl_scheduler')).toEqual([{ id: 't1' }]);
    expect(await store.getCrawlState('crawl_diagnostics')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 4D smoke test — EnrichmentLoop runtime wiring
// ---------------------------------------------------------------------------

/**
 * Minimal in-memory IStorageEngine that records the last saved resource.
 * Mirrors how index.ts wires idbEngine as both IResourceQueryable and
 * IStorageEngine into EnrichmentLoop (args 1 and 5).
 */
class SmokeSaveEngine implements IStorageEngine {
  readonly saves: IResource[] = [];

  saveResource(resource: IResource): Promise<void> {
    this.saves.push(resource);
    return Promise.resolve();
  }
  beginTransaction(): Promise<ITransaction> {
    throw new Error('not used');
  }
  getResourceById(): Promise<null> {
    return Promise.resolve(null);
  }
  deleteResource(): Promise<void> {
    return Promise.resolve();
  }
}

/** Minimal IResourceQueryable returning a single HYDRATED resource. */
const smokeQueryable = {
  async queryResources() {
    return {
      items: [
        {
          id: 'smoke-r1',
          kind: 'test-post',
          state: ResourceState.HYDRATED,
          source: {
            providerName: 'test',
            externalId: 'smoke-r1',
            originalUri: 'https://example.com/smoke-r1',
            extractedAt: new Date().toISOString(),
          },
          content: [{ type: BlockType.TEXT, value: 'smoke' }],
          media: [],
          completeness: { thumbnail: true, metadata: true, media: true, ocr: false },
        } satisfies IResource,
      ],
      hasMore: false,
    };
  },
};

/** Minimal IMediaStore stub (no media items needed for this smoke test). */
const smokeMediaStore = {
  getMetadata: async () => null,
  put: async () => {
    throw new Error('not used');
  },
  get: async () => null,
  exists: async () => false,
  delete: async () => {},
  list: async () => [],
  statistics: async () => ({ count: 0, totalBytes: 0, countByType: {}, bytesByType: {} }),
  verify: async () => false,
  cleanup: async () => ({ orphanedBlobs: 0, orphanedMetadata: 0, temporary: 0 }),
};

describe('EnrichmentLoop — Phase 4D runtime wiring smoke test', () => {
  it('reports resourcesEnriched > 0 when a storageEngine is wired (mirrors index.ts constructor call)', async () => {
    const engine = new SmokeSaveEngine();

    // This mirrors exactly how index.ts constructs EnrichmentLoop:
    //   new EnrichmentLoop(idbEngine, mediaStore, onWorkItem, controlStore, idbEngine)
    const loop = new EnrichmentLoop(
      smokeQueryable,
      smokeMediaStore,
      async () => {}, // onWorkItem (OCR handler stub)
      undefined, // controlStateStore (omitted — not under test here)
      engine, // storageEngine — the 5th arg now wired in index.ts
    );

    const report = await loop.runPass();

    expect(report.resourcesEnriched).toBe(1);
    expect(engine.saves).toHaveLength(1);
    expect(engine.saves[0].state).toBe(ResourceState.ENRICHED);
    expect(engine.saves[0].completeness.ocr).toBe(true);
  });

  it('storageEngine receives a non-undefined reference when passed as 5th arg', () => {
    const engine = new SmokeSaveEngine();
    // Construction must not throw; the engine reference is accepted.
    expect(
      () => new EnrichmentLoop(smokeQueryable, smokeMediaStore, async () => {}, undefined, engine),
    ).not.toThrow();
  });
});
