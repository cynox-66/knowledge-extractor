import {
  Logger,
  MetricsCollector,
  DiagnosticsCollector,
  IDiagnosticsState,
} from '@knowledge-extractor/shared';
import {
  IDiscoveredResource,
  ICrawlSession,
  ISessionReport,
  FailureCategory,
  ICrawlTask,
  IStorageEngine,
  IControlStateStore,
  IMediaStore,
} from '@knowledge-extractor/types';
import { InstagramConnector } from '@knowledge-extractor/connector-instagram';
import { SessionManager } from './session-manager.js';
import { Scheduler } from './scheduler.js';
import { MediaCaptureCoordinator } from './media-capture.js';

/** Pipeline stage, used to categorize failures without bespoke error classes. */
type Stage = 'navigation' | 'extraction' | 'normalization' | 'persistence' | 'capture';

/** The shape the content script returns from EXTRACT_RESOURCE. */
interface ExtractResponse {
  success: boolean;
  data?: unknown;
  strategyName?: string;
  domSnapshot?: string;
  error?: string;
}

/**
 * Supreme orchestrator of the crawl lifecycle, hardened for the MV3
 * service-worker model.
 *
 * Pipeline: Discovery → Queue → Scheduler → Navigator → Extractor → Normalizer
 *           → Persistence → Metrics/Diagnostics
 *
 * MV3 safety:
 *  - The processing loop is a self-scheduling `setTimeout` chain that only runs
 *    while a crawl is active (no perpetual `setInterval`).
 *  - A `chrome.alarms` watchdog wakes the worker after suspension and resumes
 *    the loop from persisted state.
 *  - Scheduler queue, session, and diagnostics are persisted to the durable
 *    `IControlStateStore` (IndexedDB) after every state transition, so no work
 *    is lost or duplicated. Normalized resources are persisted to the durable
 *    `IStorageEngine`. Sharing a substrate enables cross-store atomicity in a
 *    single transaction.
 */
export class CrawlController {
  static readonly ALARM_NAME = 'ke-crawl-tick';
  private static readonly SCHED_KEY = 'crawl_scheduler';
  private static readonly DIAG_KEY = 'crawl_diagnostics';
  private static readonly TICK_MS = 800;
  private static readonly MAX_EMPTY_SCROLLS = 3;
  /**
   * Discovery readiness barrier (RCA-3). Before the loop may act on an empty
   * queue (scroll or terminate), discovery must have had this long to report
   * since the last discovery opportunity (crawl start or a completed scroll).
   * Covers the content-script DiscoveryEngine's MutationObserver, its 150 ms
   * flush debounce, and the message round-trip, so the loop can no longer
   * outrun discovery and declare a premature end-of-feed.
   */
  private static readonly DISCOVERY_SETTLE_MS = 1500;

  private readonly logger = new Logger('CrawlController');
  private readonly sessionManager: SessionManager;
  private readonly scheduler = new Scheduler();

  private readonly metrics: MetricsCollector;
  private readonly diagnostics: DiagnosticsCollector;
  private readonly connector: InstagramConnector;
  private readonly storage: IStorageEngine;
  private readonly controlStore: IControlStateStore;
  /** Durable media store; consumed by `mediaCapture` (Beta-1). */
  private readonly mediaStore: IMediaStore;
  /** Captures media bytes between normalization and resource persistence. */
  private readonly mediaCapture: MediaCaptureCoordinator;

  private loopTimer: ReturnType<typeof setTimeout> | null = null;
  private isProcessing = false;
  private emptyScrolls = 0;
  /**
   * Timestamp (ms) of the last discovery opportunity — set when discovery is
   * kicked and after every scroll. The readiness barrier in
   * {@link handleQueueDrained} refuses to scroll/terminate until
   * {@link DISCOVERY_SETTLE_MS} has elapsed since this point (RCA-3).
   */
  private lastDiscoveryOpportunityAt = 0;

  constructor(
    metrics: MetricsCollector,
    diagnostics: DiagnosticsCollector,
    connector: InstagramConnector,
    storage: IStorageEngine,
    controlStore: IControlStateStore,
    mediaStore: IMediaStore,
    mediaCapture: MediaCaptureCoordinator,
  ) {
    this.metrics = metrics;
    this.diagnostics = diagnostics;
    this.connector = connector;
    this.storage = storage;
    this.controlStore = controlStore;
    this.mediaStore = mediaStore;
    this.mediaCapture = mediaCapture;
    this.sessionManager = new SessionManager(metrics, controlStore);
  }

  // ---- Lifecycle ------------------------------------------------------------

  /**
   * Initializes (or recovers) the controller. Called at every service-worker
   * startup: it rehydrates session + queue and, if a crawl was active, resumes.
   */
  async init(): Promise<void> {
    await this.sessionManager.init();
    await this.hydrateScheduler();
    await this.hydrateDiagnostics();

    const session = this.sessionManager.getSession();
    if (session?.isRunning && !session.isPaused) {
      this.logger.info('Active crawl detected on startup — resuming');
      this.markDiscoveryOpportunity();
      await this.ensureAlarm();
      this.kickLoop();
    }
    this.logger.info('CrawlController initialized');
  }

  async startCrawl(): Promise<ICrawlSession> {
    // Pin the tab for the whole crawl (RCA-8). We capture the active tab once,
    // here, where `activeTab` permission is freshly granted by the popup click,
    // and refuse to start unless it is a real Instagram tab. Every later
    // message (navigate/extract/scroll/capture) targets this id — never an
    // ambient "active tab" that can change when focus moves.
    const tab = await this.activeTab();
    if (tab?.id === undefined || !this.isInstagramUrl(tab.url)) {
      throw new Error('Open an Instagram tab and focus it before starting a crawl');
    }

    const session = this.sessionManager.startNewSession();
    await this.sessionManager.update({ tabId: tab.id });
    this.scheduler.clear();
    this.emptyScrolls = 0;
    this.markDiscoveryOpportunity();
    await this.persistScheduler();

    this.diagnostics.reset(tab.url ?? '');
    await this.persistDiagnostics();

    await this.ensureAlarm();
    this.broadcastEvent('CRAWL_STARTED', { sessionId: session.sessionId, tabId: tab.id });

    // Kick discovery in the content script (DiscoveryEngine lives there).
    await this.sendToTab(tab.id, { action: 'RUN_PIPELINE' }).catch(() => {});

    this.kickLoop();
    return this.sessionManager.getSession() ?? session;
  }

  async pauseCrawl(): Promise<void> {
    await this.sessionManager.update({ isPaused: true, navigationStatus: 'paused' });
    this.stopLoop();
    await this.clearAlarm();
    this.broadcastEvent('CRAWL_PAUSED', {});
  }

  async resumeCrawl(): Promise<void> {
    await this.sessionManager.update({ isPaused: false, navigationStatus: 'idle' });
    this.markDiscoveryOpportunity();
    await this.ensureAlarm();
    this.kickLoop();
    this.broadcastEvent('CRAWL_RESUMED', {});
  }

  async cancelCrawl(): Promise<void> {
    await this.sessionManager.update({
      isCancelled: true,
      isRunning: false,
      navigationStatus: 'cancelled',
    });
    this.stopLoop();
    await this.clearAlarm();
    this.scheduler.clear();
    await this.persistScheduler();
    this.broadcastEvent('CRAWL_CANCELLED', {});
  }

  private async finishCrawl(reason: string): Promise<void> {
    const session = this.sessionManager.getSession();
    await this.sessionManager.update({ isRunning: false, navigationStatus: `finished:${reason}` });
    this.stopLoop();
    await this.clearAlarm();
    await this.persistDiagnostics();
    this.broadcastEvent('CRAWL_FINISHED', { sessionId: session?.sessionId ?? '', reason });
    this.logger.info(`Crawl finished: ${reason}`);
  }

  // ---- Discovery intake -----------------------------------------------------

  async handleDiscoveryBatch(
    batch: Array<{ resource: IDiscoveredResource; fingerprint: string }>,
  ): Promise<void> {
    const session = this.sessionManager.getSession();
    if (!session || !session.isRunning || session.isPaused) return;

    this.broadcastEvent('DISCOVERY_BATCH', { count: batch.length });

    for (const item of batch) {
      const task = this.scheduler.enqueue(item.resource.targetUri, 0);
      if (task) {
        this.metrics.recordDiscovered();
        this.metrics.recordQueued();
        this.emptyScrolls = 0; // new work invalidates end-of-feed suspicion
        this.broadcastEvent('RESOURCE_QUEUED', {
          targetUri: task.targetUri,
          priority: task.priority,
        });
      } else {
        // Already tracked → duplicate discovery.
        this.metrics.recordDuplicate();
      }
    }

    this.metrics.observeQueueDepth(this.scheduler.getQueueDepth());
    await this.persistScheduler();
    await this.sessionManager.sync(this.scheduler.getQueueDepth());

    // Ensure the loop is running to drain the new work.
    if (session.isRunning && !session.isPaused) this.kickLoop();
  }

  // ---- Processing loop (MV3-safe) ------------------------------------------

  /** Called by the alarm watchdog to resume the loop after SW suspension. */
  async resumeFromAlarm(): Promise<void> {
    const session = this.sessionManager.getSession();
    if (session?.isRunning && !session.isPaused && !this.loopTimer) {
      this.logger.debug('Alarm watchdog resuming processing loop');
      // The worker was suspended; give discovery a fresh settle window so the
      // revived loop doesn't conclude end-of-feed before the content script
      // re-reports (RCA-3).
      this.markDiscoveryOpportunity();
      this.kickLoop();
    }
  }

  private kickLoop(): void {
    if (this.loopTimer) return;
    this.scheduleTick(0);
  }

  private scheduleTick(delay = CrawlController.TICK_MS): void {
    this.loopTimer = setTimeout(() => {
      this.loopTimer = null;
      void this.tick();
    }, delay);
  }

  private stopLoop(): void {
    if (this.loopTimer) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }
  }

  private async tick(): Promise<void> {
    const session = this.sessionManager.getSession();
    if (!session || !session.isRunning || session.isPaused) return; // halt loop
    await this.processNext();
    const after = this.sessionManager.getSession();
    if (after?.isRunning && !after.isPaused) this.scheduleTick();
  }

  private async processNext(): Promise<void> {
    if (this.isProcessing) return;

    // Resolve the pinned tab once per cycle. If it has been closed (or never
    // pinned), abandon the crawl rather than burning retries against a dead
    // tab — this is the deterministic, single-owner replacement for the old
    // "active tab" lookups (RCA-8).
    const tabId = await this.resolveSessionTabId();
    if (tabId === null) {
      await this.finishCrawl('tab-closed');
      return;
    }

    const task = this.scheduler.getNextTask();
    if (!task) {
      await this.handleQueueDrained(tabId);
      return;
    }

    this.isProcessing = true;
    let stage: Stage = 'navigation';
    try {
      await this.sessionManager.update({
        currentResource: task.targetUri,
        navigationStatus: 'opening',
      });
      this.broadcastEvent('NAVIGATION_STARTED', { targetUri: task.targetUri });

      // --- Navigation ---
      const navResponse = await this.sendToTab(tabId, {
        action: 'NAVIGATE_OPEN',
        data: { targetUri: task.targetUri },
      });
      if (!navResponse?.success) {
        throw new Error(navResponse?.error || 'Navigator failed to open resource');
      }
      this.metrics.recordNavigation(Number(navResponse.openLatencyMs) || 0);

      // --- Extraction ---
      stage = 'extraction';
      this.scheduler.markExtracting(task.id);
      await this.sessionManager.update({ navigationStatus: 'extracting' });
      this.broadcastEvent('EXTRACTION_STARTED', { targetUri: task.targetUri });

      const extractStart = performance.now();
      const extractResponse = (await this.sendToTab(tabId, {
        action: 'EXTRACT_RESOURCE',
        data: { targetUri: task.targetUri },
      })) as ExtractResponse;
      const extractionDurationMs = performance.now() - extractStart;

      if (!extractResponse?.success) {
        throw new ExtractFailure(
          extractResponse?.error || 'Extraction failed',
          extractResponse?.domSnapshot,
        );
      }
      this.metrics.recordExtracted(extractionDurationMs);
      if (extractResponse.strategyName) {
        this.diagnostics.recordStrategyUsed(extractResponse.strategyName);
      }

      // Close the modal (best-effort; not fatal).
      await this.sendToTab(tabId, { action: 'NAVIGATE_CLOSE' }).catch(() => undefined);

      // --- Normalization ---
      stage = 'normalization';
      const normStart = performance.now();
      const normalized = await this.connector.normalize(
        extractResponse.data as Parameters<InstagramConnector['normalize']>[0],
      );
      this.metrics.recordNormalized(performance.now() - normStart);
      this.broadcastEvent('RESOURCE_NORMALIZED', { resourceId: normalized.id });

      // --- Persistence (knowledge-first) ---
      // Persist the extracted resource immediately. Knowledge durability is
      // NEVER gated on media capture (RCA-6): a CDN 403 / network error must not
      // discard a successfully extracted post. The task is COMPLETE the moment
      // the resource is durable; media hydration below only upgrades it.
      stage = 'persistence';
      await this.persistResource(normalized);
      this.metrics.recordPersisted();
      this.scheduler.markCompleted(task.id);
      this.emptyScrolls = 0;
      this.broadcastEvent('RESOURCE_PERSISTED', { resourceId: normalized.id });

      // --- Capture (best-effort hydration; non-fatal) ---
      // Fetch media bytes from the pinned authenticated tab and upgrade the
      // already-persisted record (`localUri`, `state=HYDRATED`). Any failure is
      // recorded to diagnostics but never fails the task and never rolls back
      // the persisted knowledge. Transient media retries are the enrichment
      // path's concern, not the crawl task's.
      stage = 'capture';
      await this.sessionManager.update({ navigationStatus: 'capturing' });
      try {
        const captureOutcome = await this.mediaCapture.hydrate(normalized, tabId);
        for (const failure of captureOutcome.failures) {
          this.diagnostics.recordFailure(
            failure.sourceUri,
            'network_error',
            `Media capture failed: ${failure.reason}`,
            { failingStrategy: 'capture' },
          );
        }
        if (captureOutcome.persisted > 0) {
          // The resource was mutated in place (localUri / HYDRATED state); the
          // re-save reflects the captured bytes. `saveResource` is idempotent.
          await this.persistResource(normalized);
        }
        this.broadcastEvent('RESOURCE_HYDRATED', {
          resourceId: normalized.id,
          persisted: captureOutcome.persisted,
          failed: captureOutcome.failures.length,
          skipped: captureOutcome.skipped,
        });
      } catch (captureErr) {
        // Non-fatal: the resource is already durable. Surface in diagnostics only.
        this.diagnostics.recordFailure(
          task.targetUri,
          'network_error',
          `Media hydration error: ${captureErr instanceof Error ? captureErr.message : String(captureErr)}`,
          { failingStrategy: 'capture' },
        );
      }

      this.broadcastEvent('EXTRACTION_COMPLETED', {
        targetUri: task.targetUri,
        resourceId: normalized.id,
      });
    } catch (err) {
      await this.handleTaskFailure(task, stage, err);
    } finally {
      this.isProcessing = false;
      this.metrics.observeQueueDepth(this.scheduler.getQueueDepth());
      await this.persistScheduler();
      await this.persistDiagnostics();
      await this.sessionManager.update({ currentResource: '', navigationStatus: 'idle' });
      await this.sessionManager.sync(this.scheduler.getQueueDepth());
    }
  }

  /** Records a failure across metrics + diagnostics and applies the retry policy. */
  private async handleTaskFailure(task: ICrawlTask, stage: Stage, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    const domSnapshot = err instanceof ExtractFailure ? err.domSnapshot : undefined;

    // Stage-specific failure counters. Capture failures share the
    // post-extraction failure counter (the metric set is frozen at Layer 0;
    // the per-stage label flows through the diagnostic record).
    // The Layer-0 metric set is frozen; normalization and persistence share the
    // post-extraction failure counter while the precise stage flows through the
    // diagnostic record's category.
    if (stage === 'navigation') this.metrics.recordNavigationFailure();
    else if (stage === 'extraction') this.metrics.recordExtractionFailure();
    else this.metrics.recordNormalizationFailure();

    // Apply retry policy (exponential backoff lives in the Scheduler). Failures
    // that re-opening cannot fix (the resource simply isn't in the DOM) are
    // failed immediately instead of burning the retry/modal-timeout budget
    // (RCA-9).
    const updated = this.isNonRetryable(stage, message)
      ? this.scheduler.failPermanently(task.id, message)
      : this.scheduler.markFailed(task.id, message);
    const permanent = updated?.state === 'failed';
    if (permanent) {
      this.metrics.recordFailurePermanent();
    } else {
      this.metrics.recordRetry();
    }

    // Every failure is recorded to diagnostics with full context.
    this.diagnostics.recordFailure(task.targetUri, this.categoryFor(stage), message, {
      errorDetail: message,
      ...(domSnapshot ? { domSnapshot } : {}),
      failingStrategy: stage,
    });

    this.broadcastEvent('RESOURCE_FAILED', {
      targetUri: task.targetUri,
      reason: message,
      stage,
      permanent,
    });
  }

  /**
   * Whether a failure is inherently non-retryable. "Not found in DOM" outcomes
   * (the thumbnail/article isn't on the page) won't change on a re-open, so they
   * are failed permanently rather than retried with backoff (RCA-9). Transient
   * causes — modal timeouts, storage hiccups — remain on the retry path.
   */
  private isNonRetryable(stage: Stage, message: string): boolean {
    if (stage === 'navigation') return /not found/i.test(message);
    if (stage === 'extraction') return /no article element/i.test(message);
    return false;
  }

  private categoryFor(stage: Stage): FailureCategory {
    if (stage === 'navigation') return 'selector_failure';
    if (stage === 'extraction') return 'parsing_failure';
    if (stage === 'capture') return 'network_error';
    if (stage === 'persistence') return 'unknown';
    return 'normalization_failure';
  }

  /**
   * Drives infinite scroll when the queue empties; terminates at end-of-feed.
   *
   * Two invariants make termination robust (RCA-3, RCA-4):
   *  1. **Readiness barrier** — the loop never scrolls or terminates until
   *     {@link DISCOVERY_SETTLE_MS} has elapsed since the last discovery
   *     opportunity. While inside that window it simply yields back to the tick
   *     loop, which polls again. This is what stops the loop outrunning the
   *     content-script DiscoveryEngine and declaring a premature end-of-feed.
   *  2. **No single false negative terminates** — a scroll that reports no new
   *     height increments `emptyScrolls` like any other; the crawl ends only
   *     after {@link MAX_EMPTY_SCROLLS} *consecutive* unproductive scrolls.
   *     Newly discovered work resets `emptyScrolls` to 0 (see
   *     {@link handleDiscoveryBatch} and the per-resource success path).
   *
   * @param tabId The pinned, already-validated crawl tab (RCA-8).
   */
  private async handleQueueDrained(tabId: number): Promise<void> {
    if (!this.scheduler.isDrained()) return; // tasks still mid-flight

    // (1) Readiness barrier: give discovery its settle window before acting.
    if (Date.now() - this.lastDiscoveryOpportunityAt < CrawlController.DISCOVERY_SETTLE_MS) {
      return; // poll again on the next tick; do not scroll or terminate yet
    }

    // (2) End-of-feed only after MAX consecutive unproductive scrolls.
    if (this.emptyScrolls >= CrawlController.MAX_EMPTY_SCROLLS) {
      await this.finishCrawl('feed-exhausted');
      return;
    }

    await this.sessionManager.update({ navigationStatus: 'scrolling' });
    // The Navigator's success/height signal is deliberately not used as a
    // terminal condition (RCA-4): a single no-growth reading must not end the
    // crawl. Productivity is judged solely by whether discovery reports new work
    // during the settle window below, which resets `emptyScrolls`.
    await this.sendToTab(tabId, { action: 'NAVIGATE_SCROLL' }).catch(() => undefined);

    // A scroll exposes new content asynchronously (lazy load → MutationObserver
    // → flush → RESOURCES_DISCOVERED). Open a fresh discovery window so the next
    // drain waits for that pipeline before counting this scroll as unproductive.
    this.markDiscoveryOpportunity();

    // Count every scroll attempt — whether it reported new height or not. If it
    // produced new work, the discovery batch resets the counter during the
    // settle window above; otherwise consecutive empties trip end-of-feed.
    this.emptyScrolls++;
  }

  // ---- Persistence helpers --------------------------------------------------

  private async persistScheduler(): Promise<void> {
    await this.controlStore.saveCrawlState(CrawlController.SCHED_KEY, this.scheduler.snapshot());
  }

  private async hydrateScheduler(): Promise<void> {
    const tasks = await this.controlStore.getCrawlState<ICrawlTask[]>(CrawlController.SCHED_KEY);
    if (tasks && tasks.length > 0) {
      this.scheduler.restore(tasks);
      this.metrics.observeQueueDepth(this.scheduler.getQueueDepth());
    }
  }

  private async persistDiagnostics(): Promise<void> {
    await this.controlStore.saveCrawlState(CrawlController.DIAG_KEY, this.diagnostics.snapshot());
  }

  private async hydrateDiagnostics(): Promise<void> {
    const state = await this.controlStore.getCrawlState<IDiagnosticsState>(
      CrawlController.DIAG_KEY,
    );
    if (state) {
      this.diagnostics.hydrate(state);
    }
  }

  // ---- Public accessors (for the message dispatcher) ------------------------

  getSession(): ICrawlSession | null {
    return this.sessionManager.getSession();
  }

  exportDiagnostics(): ISessionReport {
    return this.diagnostics.buildReport(this.metrics.snapshot());
  }

  /**
   * Exposes the durable media store for later phases (e.g. the Beta-1 media
   * capture / OCR pipeline). Not consumed in Beta-0.
   */
  getMediaStore(): IMediaStore {
    return this.mediaStore;
  }

  // ---- Chrome glue ----------------------------------------------------------

  private async ensureAlarm(): Promise<void> {
    await chrome.alarms.create(CrawlController.ALARM_NAME, { periodInMinutes: 1 });
  }

  private async clearAlarm(): Promise<void> {
    await chrome.alarms.clear(CrawlController.ALARM_NAME);
  }

  /**
   * The currently active tab in the focused window. Used **only** at
   * {@link startCrawl} to pin the crawl tab, where `activeTab` permission is
   * freshly granted by the popup click. The running loop never queries the
   * active tab again — it uses the pinned id (RCA-8).
   */
  private async activeTab(): Promise<chrome.tabs.Tab | undefined> {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0];
  }

  /**
   * Resolves the pinned crawl tab from the persisted session and verifies it
   * still exists. Returns `null` if no tab was pinned or it has been closed, so
   * callers can deterministically finish the crawl instead of messaging a dead
   * or wrong tab.
   */
  private async resolveSessionTabId(): Promise<number | null> {
    const tabId = this.sessionManager.getSession()?.tabId;
    if (typeof tabId !== 'number') return null;
    try {
      await chrome.tabs.get(tabId); // rejects if the tab no longer exists
      return tabId;
    } catch {
      return null;
    }
  }

  private isInstagramUrl(url: string | undefined): boolean {
    if (!url) return false;
    try {
      return new URL(url).hostname.endsWith('instagram.com');
    } catch {
      return false;
    }
  }

  /** Opens a fresh discovery settle window (RCA-3). */
  private markDiscoveryOpportunity(): void {
    this.lastDiscoveryOpportunityAt = Date.now();
  }

  /** Persists a single resource in its own atomic transaction. Idempotent. */
  private async persistResource(
    resource: Parameters<IStorageEngine['saveResource']>[0],
  ): Promise<void> {
    const tx = await this.storage.beginTransaction();
    await this.storage.saveResource(resource, tx);
    await tx.commit();
  }

  private async sendToTab(tabId: number, message: unknown): Promise<NavResponse> {
    return (await chrome.tabs.sendMessage(tabId, message)) as NavResponse;
  }

  private broadcastEvent(action: string, payload: unknown): void {
    this.logger.debug(`[EVENT] ${action}`, payload);
    chrome.runtime
      .sendMessage({ action: 'SYSTEM_STATUS', data: { stage: action, payload } })
      .catch(() => {});
  }
}

/** Loose response shape for content-script messages (navigation/scroll/etc.). */
interface NavResponse {
  success?: boolean;
  error?: string;
  openLatencyMs?: number;
  domStabilizeMs?: number;
  closeDurationMs?: number;
  stabilizeMs?: number;
  [key: string]: unknown;
}

/** Carries the failure DOM snapshot from the extraction stage to diagnostics. */
class ExtractFailure extends Error {
  constructor(
    message: string,
    public readonly domSnapshot?: string,
  ) {
    super(message);
    this.name = 'ExtractFailure';
  }
}
