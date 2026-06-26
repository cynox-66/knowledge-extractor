import { Logger, MetricsCollector, DiagnosticsCollector } from '@knowledge-extractor/shared';
import { IDiscoveredResource, ICrawlSession } from '@knowledge-extractor/types';
import { InstagramConnector } from '@knowledge-extractor/connector-instagram';
import { InMemoryStorage } from '@knowledge-extractor/storage';
import { SessionManager } from './session-manager';
import { Scheduler } from './scheduler';

/**
 * Supreme Orchestrator of the Crawl Lifecycle.
 * Pipeline: Discovery → Queue → Scheduler → Navigator → Extractor → Normalizer → Persistence
 */
export class CrawlController {
  private readonly logger = new Logger('CrawlController');
  private readonly sessionManager = new SessionManager();
  private readonly scheduler = new Scheduler();

  // External dependencies
  private metrics: MetricsCollector;
  private diagnostics: DiagnosticsCollector;
  private connector: InstagramConnector;
  private storage: InMemoryStorage;

  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private isProcessing = false;

  constructor(
    metrics: MetricsCollector,
    diagnostics: DiagnosticsCollector,
    connector: InstagramConnector,
    storage: InMemoryStorage,
  ) {
    this.metrics = metrics;
    this.diagnostics = diagnostics;
    this.connector = connector;
    this.storage = storage;
  }

  async init(): Promise<void> {
    await this.sessionManager.init();
    this.logger.info('CrawlController initialized');
  }

  async startCrawl(): Promise<ICrawlSession> {
    const session = this.sessionManager.startNewSession();
    this.scheduler.clear();
    this.metrics.reset();

    // We'll broadcast this event externally
    this.broadcastEvent('CRAWL_STARTED', { sessionId: session.sessionId });

    this.startProcessingLoop();
    return session;
  }

  async pauseCrawl(): Promise<void> {
    await this.sessionManager.update({ isPaused: true });
    this.stopProcessingLoop();
    this.broadcastEvent('CRAWL_PAUSED', {});
  }

  async resumeCrawl(): Promise<void> {
    await this.sessionManager.update({ isPaused: false });
    this.startProcessingLoop();
    this.broadcastEvent('CRAWL_RESUMED', {});
  }

  async cancelCrawl(): Promise<void> {
    await this.sessionManager.update({ isCancelled: true, isRunning: false });
    this.stopProcessingLoop();
    this.scheduler.clear();
    this.broadcastEvent('CRAWL_CANCELLED', {});
  }

  async handleDiscoveryBatch(
    batch: Array<{ resource: IDiscoveredResource; fingerprint: string }>,
  ): Promise<void> {
    const session = this.sessionManager.getSession();
    if (!session || !session.isRunning || session.isPaused) return;

    this.broadcastEvent('DISCOVERY_BATCH', { count: batch.length });

    for (const item of batch) {
      // Default priority 0. Newest discovered items might get higher priority in future if we want LIFO
      const task = this.scheduler.enqueue(item.resource.targetUri, 0);
      if (task) {
        await this.sessionManager.increment('discovered');
        await this.sessionManager.increment('queued');
        this.broadcastEvent('RESOURCE_QUEUED', {
          targetUri: task.targetUri,
          priority: task.priority,
        });
      }
    }
  }

  private startProcessingLoop(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => this.processNext(), 1000);
  }

  private stopProcessingLoop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async processNext(): Promise<void> {
    if (this.isProcessing) return;
    const session = this.sessionManager.getSession();
    if (!session || !session.isRunning || session.isPaused) return;

    const task = this.scheduler.getNextTask();
    if (!task) {
      // If we are out of tasks, maybe trigger navigation scroll?
      // This will be orchestrated via Navigator later.
      return;
    }

    this.isProcessing = true;
    try {
      await this.sessionManager.update({ currentResource: task.targetUri });
      this.broadcastEvent('NAVIGATION_STARTED', { targetUri: task.targetUri });

      // PHASE 2: Coordinate with Navigator to open the resource
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tabs[0]?.id) throw new Error('No active tab');

      const navResponse = await chrome.tabs.sendMessage(tabs[0].id, {
        action: 'NAVIGATE_OPEN',
        data: { targetUri: task.targetUri },
      });

      if (!navResponse?.success) {
        throw new Error(navResponse?.error || 'Navigator failed to open resource');
      }

      this.scheduler.markExtracting(task.id);
      this.broadcastEvent('EXTRACTION_STARTED', { targetUri: task.targetUri });

      // Execute Extraction
      const extractStart = performance.now();
      const extractResponse = await chrome.tabs.sendMessage(tabs[0].id, {
        action: 'EXTRACT_RESOURCE',
        data: { targetUri: task.targetUri },
      });
      const extractionDurationMs = performance.now() - extractStart;

      if (!extractResponse?.success) {
        throw new Error(extractResponse?.error || 'Extraction failed');
      }

      // Close resource (modal) after extraction
      const closeResponse = await chrome.tabs.sendMessage(tabs[0].id, { action: 'NAVIGATE_CLOSE' });

      await this.sessionManager.addMetrics({
        modalOpenLatencyMs: navResponse.openLatencyMs,
        domStabilizationTimeMs: navResponse.domStabilizeMs,
        extractionDurationMs,
        modalCloseDurationMs: closeResponse?.closeDurationMs,
      });

      // Execute Normalization
      const normalized = await this.connector.normalize(
        extractResponse.data as Parameters<InstagramConnector['normalize']>[0],
      );
      this.broadcastEvent('RESOURCE_NORMALIZED', normalized);

      // Execute Persistence
      const tx = await this.storage.beginTransaction();
      await this.storage.saveResource(normalized, tx);
      await tx.commit();
      this.broadcastEvent('RESOURCE_PERSISTED', { resourceId: normalized.id });

      this.scheduler.markCompleted(task.id);
      await this.sessionManager.increment('extracted');
      this.broadcastEvent('EXTRACTION_COMPLETED', {
        targetUri: task.targetUri,
        resourceId: task.id,
      });
    } catch (err) {
      const errorMsg = String(err);
      const updatedTask = this.scheduler.markFailed(task.id, errorMsg);
      if (updatedTask?.state === 'failed') {
        await this.sessionManager.increment('failed');
      }
      await this.sessionManager.increment('totalRetries');
      this.broadcastEvent('RESOURCE_FAILED', { targetUri: task.targetUri, reason: errorMsg });
    } finally {
      this.isProcessing = false;
      await this.sessionManager.update({ currentResource: undefined });
    }
  }

  private broadcastEvent(action: string, payload: unknown): void {
    // Also log internally
    this.logger.debug(`[EVENT] ${action}`, payload);
    // Push to extension messaging
    chrome.runtime
      .sendMessage({ action: 'SYSTEM_STATUS', data: { stage: action, payload } })
      .catch(() => {});
  }
}
