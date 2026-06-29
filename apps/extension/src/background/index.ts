/**
 * Background Worker — Composition Root.
 *
 * This module is the ONLY place that constructs infrastructure (storage engine,
 * media store, metrics, diagnostics, connector, controller). Every subsystem
 * receives its dependencies by constructor injection; controllers never build
 * infrastructure themselves.
 *
 * MV3 service worker: all event listeners are registered synchronously at the
 * top level (before any `await`) so the revived worker never misses an event.
 * Asynchronous startup (persistence request + recovery) runs afterwards.
 */
import { Logger, MetricsCollector, DiagnosticsCollector } from '@knowledge-extractor/shared';
import {
  IDiscoveredResource,
  IStorageEngine,
  IControlStateStore,
  IMediaStore,
  IExportRequest,
  IMediaRetentionPolicy,
} from '@knowledge-extractor/types';
import { CrawlController } from './crawl-controller.js';
import { EnrichmentLoop } from './enrichment-loop.js';
import { OcrEngine } from './ocr-engine.js';
import { MediaCaptureCoordinator, type ICaptureTransport } from './media-capture.js';
import { ExportCoordinator } from './export/coordinator.js';
import { ExportWriter } from './export/writer.js';
import { ChromeDownloadGateway } from './export/download-gateway.js';
import { createSerializerRegistry } from './export/registry.js';
import { MediaJanitor } from './media-janitor.js';
import { SmokeHarness } from './smoke-harness.js';
import { InstagramConnector } from '@knowledge-extractor/connector-instagram';
import {
  IndexedDbStorageEngine,
  InMemoryStorage,
  MediaStore,
  OpfsBlobBackend,
  InMemoryBlobBackend,
} from '@knowledge-extractor/storage';

const logger = new Logger('BackgroundWorker');
const metrics = new MetricsCollector();
const diagnostics = new DiagnosticsCollector();
const connector = new InstagramConnector();

/**
 * Volatile fallback for `IControlStateStore` when IndexedDB is unavailable.
 * Kept local to the composition root because it is only ever instantiated by
 * the bootstrap — no new exported abstraction.
 */
class InMemoryControlStateStore implements IControlStateStore {
  private readonly sessions = new Map<string, unknown>();
  private readonly diagnostics = new Map<string, unknown>();
  private readonly crawlState = new Map<string, unknown>();
  saveSession(s: { sessionId: string }): Promise<void> {
    this.sessions.set(s.sessionId, s);
    return Promise.resolve();
  }
  getSession(id: string): Promise<never> {
    return Promise.resolve(this.sessions.get(id) as never);
  }
  listSessions(): Promise<never> {
    return Promise.resolve([...this.sessions.values()] as never);
  }
  saveDiagnostics(r: { sessionId: string }): Promise<void> {
    this.diagnostics.set(r.sessionId, r);
    return Promise.resolve();
  }
  getDiagnostics(id: string): Promise<never> {
    return Promise.resolve(this.diagnostics.get(id) as never);
  }
  saveCrawlState(key: string, value: unknown): Promise<void> {
    this.crawlState.set(key, value);
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

// Durable resource + control-state storage. IndexedDB is the default; in the
// rare environment where it is unavailable, degrade to volatile in-memory
// resource storage (with a clear warning). Control state cannot be made
// durable without IndexedDB, so the same fallback applies — the unified
// `IndexedDbStorageEngine` implements both `IStorageEngine` and
// `IControlStateStore`, so a single instance serves both contracts.
const idbEngine = typeof indexedDB !== 'undefined' ? new IndexedDbStorageEngine() : null;
const storage: IStorageEngine = idbEngine ?? new InMemoryStorage();
const controlStore: IControlStateStore = idbEngine ?? new InMemoryControlStateStore();
if (!idbEngine) {
  logger.warn('IndexedDB unavailable — using volatile in-memory storage + control state');
}

// Durable media store (bytes in OPFS). Falls back to a volatile in-memory blob
// backend where OPFS is unavailable.
const mediaStore: IMediaStore = new MediaStore(
  OpfsBlobBackend.isSupported() ? new OpfsBlobBackend() : new InMemoryBlobBackend(),
);
if (!OpfsBlobBackend.isSupported()) {
  logger.warn('OPFS unavailable — media store using volatile in-memory backend');
}

/**
 * Capture transport: forwards the controller's request to the active tab's
 * content script, which is the only context with the authenticated Instagram
 * session. Kept inline (no new exported abstraction) — the coordinator depends
 * on the small `ICaptureTransport` interface; this is its sole production impl.
 */
const captureTransport: ICaptureTransport = {
  async capture(items, tabId) {
    // The controller pins exactly one Instagram tab per crawl and threads its
    // id here (RCA-8). No ambient `chrome.tabs.query` — capture always targets
    // the same authenticated tab the rest of the pipeline drives.
    if (typeof tabId !== 'number') {
      return {
        success: false,
        captured: [],
        failed: items.map((i) => ({ id: i.id, error: 'No pinned tab' })),
      };
    }
    return (await chrome.tabs.sendMessage(tabId, {
      action: 'CAPTURE_MEDIA',
      data: { mediaItems: items },
    })) as Awaited<ReturnType<ICaptureTransport['capture']>>;
  },
};
const mediaCapture = new MediaCaptureCoordinator(captureTransport, mediaStore);

const controller = new CrawlController(
  metrics,
  diagnostics,
  connector,
  storage,
  controlStore,
  mediaStore,
  mediaCapture,
);

// Live-run smoke harness (P3). Dev-triggered via the RUN_SMOKE message; drives
// the real controller + metrics and reports an objective PASS/FAIL per surface.
const smokeHarness = new SmokeHarness(controller, metrics, async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.url ?? '';
});

// OCR engine and enrichment loop: only available when IndexedDB is present.
// OcrEngine manages the offscreen document lifecycle; EnrichmentLoop calls its
// process() method as the onWorkItem handler.
const ocrEngine = idbEngine !== null ? new OcrEngine(idbEngine, mediaStore) : null;
const enrichmentLoop =
  idbEngine !== null
    ? new EnrichmentLoop(
        idbEngine,
        mediaStore,
        ocrEngine !== null ? ocrEngine.process.bind(ocrEngine) : undefined,
        controlStore,
        idbEngine,
      )
    : null;

// Export subsystem (Beta-3 M4). The composition root is the only place the
// serializer registry, writer, download gateway, and coordinator are built;
// each receives its infrastructure by injection. The coordinator requires an
// IResourceQueryable (paged reads) + durable control state, so — like the
// enrichment loop — it is only available when IndexedDB is present.
const exportWriter = new ExportWriter(mediaStore, new ChromeDownloadGateway());
const serializerRegistry = createSerializerRegistry();
const exportCoordinator =
  idbEngine !== null
    ? new ExportCoordinator(idbEngine, mediaStore, controlStore, serializerRegistry, exportWriter)
    : null;

// Media retention policy (Beta-3 M6). Default production policy: cache mode
// with a 500 MB soft cap, video not retained. The janitor is only meaningful
// when IndexedDB is present (it needs to query resource states to enforce the
// eviction invariant). Policy and pinned-ids may be overridden via settings UI
// in a future milestone; stored in control state under 'media_retention_policy'.
const defaultRetentionPolicy: IMediaRetentionPolicy = {
  fullMediaMode: 'cache',
  maxCacheBytes: 500 * 1024 * 1024, // 500 MB
  retainVideo: false,
};
const mediaJanitor =
  idbEngine !== null
    ? new MediaJanitor(mediaStore, idbEngine, defaultRetentionPolicy, controlStore)
    : null;

/** Requests durable (non-evictable) storage. Best-effort; safe if unsupported. */
async function requestPersistence(): Promise<void> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
      const granted = await navigator.storage.persist();
      logger.info(`Persistent storage ${granted ? 'granted' : 'denied'}`);
    } else {
      logger.warn('navigator.storage.persist() unavailable');
    }
  } catch (err) {
    logger.warn('Persistence request failed', err);
  }
}

/**
 * One-shot migration: lift control state out of `chrome.storage.local` and into
 * the durable `IControlStateStore` (IndexedDB). Beta-0 Phase 3 wrote three keys
 * (`crawl_session`, `crawl_scheduler`, `crawl_diagnostics`) to
 * `chrome.storage.local`; Phase 3.5 reads them once, writes them to IndexedDB,
 * then clears them. Idempotent — a second run is a no-op.
 */
async function migrateLegacyControlState(): Promise<void> {
  // Skip when chrome.storage isn't available (e.g. tests) or when IDB itself
  // is the fallback (nowhere to migrate to durably).
  if (typeof chrome === 'undefined' || !chrome.storage?.local || !idbEngine) return;

  const LEGACY = ['crawl_session', 'crawl_scheduler', 'crawl_diagnostics'] as const;
  try {
    const found = await chrome.storage.local.get(LEGACY as unknown as string[]);
    const session = found['crawl_session'];
    const scheduler = found['crawl_scheduler'];
    const diag = found['crawl_diagnostics'];
    if (!session && !scheduler && !diag) return; // already migrated or fresh install

    if (session) await controlStore.saveCrawlState('current_session', session);
    if (scheduler) await controlStore.saveCrawlState('crawl_scheduler', scheduler);
    if (diag) await controlStore.saveCrawlState('crawl_diagnostics', diag);

    await chrome.storage.local.remove(LEGACY as unknown as string[]);
    logger.info('Migrated legacy control state from chrome.storage.local → IndexedDB');
  } catch (err) {
    logger.warn('Legacy control-state migration failed (continuing)', err);
  }
}

/** Async startup: request persistence, migrate legacy state, probe, recover. */
async function startup(): Promise<void> {
  await requestPersistence();
  await migrateLegacyControlState();
  // Probe durable storage so a hard failure (quota/corruption) is visible in
  // diagnostics instead of silently failing every later persistence.
  try {
    await storage.getResourceById('__startup_probe__');
  } catch (err) {
    logger.error('Durable storage probe failed — resources may not persist', err);
    diagnostics.recordFailure('storage', 'unknown', 'Durable storage unavailable at startup', {
      errorDetail: String(err),
    });
  }
  await controller.init();

  // Resume an export interrupted by a prior worker eviction / browser restart.
  // Fire-and-forget: a no-op when nothing is pending.
  exportCoordinator?.resume().catch((err) => logger.warn('Export resume failed (non-fatal)', err));

  // Schedule the media retention janitor (Beta-3 M6). Runs every 30 minutes;
  // idempotent if the worker is revived and startup() is called again.
  mediaJanitor?.schedule();

  // Cleanup then enrichment — sequential to prevent a race on the in-memory
  // media index (cleanup resets it; enrichment reads from it). Both remain
  // fire-and-forget from startup's perspective: neither blocks controller.init()
  // completion, and cleanup failure is non-fatal.
  mediaStore
    .cleanup()
    .catch((err) => logger.warn('MediaStore cleanup failed (non-fatal)', err))
    .then(() => {
      if (enrichmentLoop !== null) {
        enrichmentLoop.start();
      }
    });
}

startup().catch((err) => logger.error('Startup failed', err));

// ---- Watchdog: resume the processing loop after SW suspension ---------------
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CrawlController.ALARM_NAME) {
    controller.resumeFromAlarm().catch((err) => logger.error('Alarm resume failed', err));
  }
  if (alarm.name === EnrichmentLoop.ALARM_NAME) {
    enrichmentLoop?.handleAlarm();
  }
  if (alarm.name === ExportCoordinator.ALARM_NAME) {
    exportCoordinator?.handleAlarm();
  }
  if (alarm.name === MediaJanitor.ALARM_NAME) {
    mediaJanitor?.handleAlarm();
  }
});

// ---- Message Dispatcher -----------------------------------------------------
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'START_PIPELINE') {
    controller
      .startCrawl()
      .then((session) => sendResponse({ success: true, session }))
      // Forward the reason so the popup can surface "open an Instagram tab
      // first" instead of a silent failure (tab pinning, RCA-8).
      .catch((err: unknown) =>
        sendResponse({ success: false, error: err instanceof Error ? err.message : String(err) }),
      );
    return true;
  }

  if (message.action === 'PAUSE_PIPELINE') {
    controller.pauseCrawl().then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.action === 'RESUME_PIPELINE') {
    controller.resumeCrawl().then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.action === 'CANCEL_PIPELINE') {
    controller.cancelCrawl().then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.action === 'GET_SESSION') {
    sendResponse(controller.getSession());
    return false;
  }

  // Live-run smoke harness (P3): runs one bounded crawl on the active surface
  // and replies with an objective PASS/FAIL report. Dev/QA trigger only.
  if (message.action === 'RUN_SMOKE') {
    smokeHarness
      .run((message.data as { timeoutMs?: number; pollMs?: number } | undefined) ?? {})
      .then((report) => sendResponse(report))
      .catch((err: unknown) =>
        sendResponse({ pass: false, error: err instanceof Error ? err.message : String(err) }),
      );
    return true;
  }

  if (message.action === 'RESOURCES_DISCOVERED') {
    controller
      .handleDiscoveryBatch(
        message.data as Array<{ resource: IDiscoveredResource; fingerprint: string }>,
      )
      .catch((err) => logger.error('Discovery batch error', err));
    return false;
  }

  if (message.action === 'EXPORT_DIAGNOSTICS') {
    sendResponse(controller.exportDiagnostics());
    return false;
  }

  // ---- Export orchestration (Beta-3 M4) ------------------------------------
  if (message.action === 'START_EXPORT') {
    if (exportCoordinator === null) {
      sendResponse({ accepted: false, reason: 'Export unavailable: no durable storage' });
      return false;
    }
    sendResponse(exportCoordinator.start(message.data as IExportRequest));
    return false;
  }

  if (message.action === 'CANCEL_EXPORT') {
    exportCoordinator?.cancel();
    sendResponse({ success: true });
    return false;
  }

  if (message.action === 'GET_EXPORT_PROGRESS') {
    if (exportCoordinator === null) {
      sendResponse(null);
      return false;
    }
    exportCoordinator
      .getProgress()
      .then((progress) => sendResponse(progress))
      .catch(() => sendResponse(null));
    return true;
  }

  return false;
});
