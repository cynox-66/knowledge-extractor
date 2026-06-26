import { Logger, MetricsCollector, DiagnosticsCollector } from '@knowledge-extractor/shared';
import { IDiscoveredResource, ICrawlSession } from '@knowledge-extractor/types';
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

  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private isProcessing = false;

  constructor(metrics: MetricsCollector, diagnostics: DiagnosticsCollector) {
    this.metrics = metrics;
    this.diagnostics = diagnostics;
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

      // PHASE 2 & 3: Here we will coordinate with Navigator to open the resource.
      // For now, this is a placeholder to show the flow.
      // await Navigator.openResource(task.targetUri);

      this.scheduler.markExtracting(task.id);
      this.broadcastEvent('EXTRACTION_STARTED', { targetUri: task.targetUri });

      // Placeholder: Execute Extraction & Normalization
      // const extracted = await Extractor.extract(task.targetUri);
      // const normalized = await Normalizer.normalize(extracted);

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
