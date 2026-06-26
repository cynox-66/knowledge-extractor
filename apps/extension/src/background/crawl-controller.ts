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
  IMediaStore,
} from '@knowledge-extractor/types';
import { InstagramConnector } from '@knowledge-extractor/connector-instagram';
import { SessionManager } from './session-manager.js';
import { Scheduler } from './scheduler.js';

/** Pipeline stage, used to categorize failures without bespoke error classes. */
type Stage = 'navigation' | 'extraction' | 'normalization';

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
 *  - Scheduler queue, session, and diagnostics are persisted to
 *    `chrome.storage.local` (durable across browser restart) after every state
 *    transition, so no work is lost or duplicated. Normalized resources are
 *    persisted to the durable `IStorageEngine`.
 */
export class CrawlController {
  static readonly ALARM_NAME = 'ke-crawl-tick';
  private static readonly SCHED_KEY = 'crawl_scheduler';
  private static readonly DIAG_KEY = 'crawl_diagnostics';
  private static readonly TICK_MS = 800;
  private static readonly MAX_EMPTY_SCROLLS = 3;

  private readonly logger = new Logger('CrawlController');
  private readonly sessionManager: SessionManager;
  private readonly scheduler = new Scheduler();

  private readonly metrics: MetricsCollector;
  private readonly diagnostics: DiagnosticsCollector;
  private readonly connector: InstagramConnector;
  private readonly storage: IStorageEngine;
  /** Durable media store. Owned here for later phases; not consumed in Beta-0. */
  private readonly mediaStore: IMediaStore;

  private loopTimer: ReturnType<typeof setTimeout> | null = null;
  private isProcessing = false;
  private emptyScrolls = 0;

  constructor(
    metrics: MetricsCollector,
    diagnostics: DiagnosticsCollector,
    connector: InstagramConnector,
    storage: IStorageEngine,
    mediaStore: IMediaStore,
  ) {
    this.metrics = metrics;
    this.diagnostics = diagnostics;
    this.connector = connector;
    this.storage = storage;
    this.mediaStore = mediaStore;
    this.sessionManager = new SessionManager(metrics);
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
      await this.ensureAlarm();
      this.kickLoop();
    }
    this.logger.info('CrawlController initialized');
  }

  async startCrawl(): Promise<ICrawlSession> {
    const session = this.sessionManager.startNewSession();
    this.scheduler.clear();
    this.emptyScrolls = 0;
    await this.persistScheduler();

    const pageUrl = await this.activeTabUrl();
    this.diagnostics.reset(pageUrl);
    await this.persistDiagnostics();

    await this.ensureAlarm();
    this.broadcastEvent('CRAWL_STARTED', { sessionId: session.sessionId });

    // Kick discovery in the content script (DiscoveryEngine lives there).
    await this.sendToActiveTab({ action: 'RUN_PIPELINE' }).catch(() => {});

    this.kickLoop();
    return session;
  }

  async pauseCrawl(): Promise<void> {
    await this.sessionManager.update({ isPaused: true, navigationStatus: 'paused' });
    this.stopLoop();
    await this.clearAlarm();
    this.broadcastEvent('CRAWL_PAUSED', {});
  }

  async resumeCrawl(): Promise<void> {
    await this.sessionManager.update({ isPaused: false, navigationStatus: 'idle' });
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

    const task = this.scheduler.getNextTask();
    if (!task) {
      await this.handleQueueDrained();
      return;
    }

    this.isProcessing = true;
    let stage: Stage = 'navigation';
    try {
      const tabId = await this.requireActiveTabId();

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

      // --- Persistence ---
      const tx = await this.storage.beginTransaction();
      await this.storage.saveResource(normalized, tx);
      await tx.commit();
      this.metrics.recordPersisted();
      this.broadcastEvent('RESOURCE_PERSISTED', { resourceId: normalized.id });

      this.scheduler.markCompleted(task.id);
      this.emptyScrolls = 0;
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

    // Stage-specific failure counters.
    if (stage === 'navigation') this.metrics.recordNavigationFailure();
    else if (stage === 'extraction') this.metrics.recordExtractionFailure();
    else this.metrics.recordNormalizationFailure();

    // Apply retry policy (exponential backoff lives in the Scheduler).
    const updated = this.scheduler.markFailed(task.id, message);
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

  private categoryFor(stage: Stage): FailureCategory {
    if (stage === 'navigation') return 'selector_failure';
    if (stage === 'extraction') return 'parsing_failure';
    return 'normalization_failure';
  }

  /** Drives infinite scroll when the queue empties; terminates at end-of-feed. */
  private async handleQueueDrained(): Promise<void> {
    if (!this.scheduler.isDrained()) return; // tasks still mid-flight

    if (this.emptyScrolls >= CrawlController.MAX_EMPTY_SCROLLS) {
      await this.finishCrawl('feed-exhausted');
      return;
    }

    const tabId = await this.activeTabId();
    if (tabId === null) {
      await this.finishCrawl('no-active-tab');
      return;
    }

    await this.sessionManager.update({ navigationStatus: 'scrolling' });
    const scroll = await this.sendToTab(tabId, { action: 'NAVIGATE_SCROLL' }).catch(() => null);

    if (!scroll || scroll.success === false) {
      // Navigator reports no new height → bottom of the feed.
      await this.finishCrawl('end-of-feed');
      return;
    }

    // Scroll succeeded; new content (if any) arrives via RESOURCES_DISCOVERED.
    // If repeated scrolls yield no new work, emptyScrolls trips end-of-feed.
    this.emptyScrolls++;
  }

  // ---- Persistence helpers --------------------------------------------------

  private async persistScheduler(): Promise<void> {
    await chrome.storage.local.set({
      [CrawlController.SCHED_KEY]: this.scheduler.snapshot(),
    });
  }

  private async hydrateScheduler(): Promise<void> {
    const data = await chrome.storage.local.get(CrawlController.SCHED_KEY);
    const tasks = data[CrawlController.SCHED_KEY] as ICrawlTask[] | undefined;
    if (tasks && tasks.length > 0) {
      this.scheduler.restore(tasks);
      this.metrics.observeQueueDepth(this.scheduler.getQueueDepth());
    }
  }

  private async persistDiagnostics(): Promise<void> {
    await chrome.storage.local.set({
      [CrawlController.DIAG_KEY]: this.diagnostics.snapshot(),
    });
  }

  private async hydrateDiagnostics(): Promise<void> {
    const data = await chrome.storage.local.get(CrawlController.DIAG_KEY);
    const state = data[CrawlController.DIAG_KEY] as IDiagnosticsState | undefined;
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

  private async activeTabId(): Promise<number | null> {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0]?.id ?? null;
  }

  private async requireActiveTabId(): Promise<number> {
    const id = await this.activeTabId();
    if (id === null) throw new Error('No active tab');
    return id;
  }

  private async activeTabUrl(): Promise<string> {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0]?.url ?? '';
  }

  private async sendToActiveTab(message: unknown): Promise<NavResponse> {
    const id = await this.requireActiveTabId();
    return this.sendToTab(id, message);
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
