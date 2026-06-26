import { IExtractionMetrics } from '@knowledge-extractor/types';
import { Logger } from './logger.js';

/**
 * The canonical runtime metrics source for a crawl session.
 *
 * Accumulates pipeline-stage counters, failure counters, and timing totals,
 * and emits a derived `IExtractionMetrics` snapshot on demand. The snapshot is
 * persisted into `ICrawlSession`; the Popup renders from it. SessionManager
 * consumes this collector rather than maintaining its own counters.
 */
export class MetricsCollector {
  private readonly logger = new Logger('MetricsCollector');

  private sessionStart = new Date().toISOString();
  private crawlStartMs = Date.now();

  // Stage counters
  private discovered = 0;
  private queued = 0;
  private extracted = 0;
  private normalized = 0;
  private persisted = 0;
  private duplicates = 0;
  private skipped = 0;

  // Failure counters
  private failed = 0;
  private retries = 0;
  private navigationFailures = 0;
  private extractionFailures = 0;
  private normalizationFailures = 0;

  // Timing totals + the sample counts used to derive averages
  private extractionTimeMs = 0;
  private normalizationTimeMs = 0;
  private navigationTimeMs = 0;
  private navigations = 0;

  private peakQueueSize = 0;

  reset(): void {
    this.sessionStart = new Date().toISOString();
    this.crawlStartMs = Date.now();
    this.discovered = 0;
    this.queued = 0;
    this.extracted = 0;
    this.normalized = 0;
    this.persisted = 0;
    this.duplicates = 0;
    this.skipped = 0;
    this.failed = 0;
    this.retries = 0;
    this.navigationFailures = 0;
    this.extractionFailures = 0;
    this.normalizationFailures = 0;
    this.extractionTimeMs = 0;
    this.normalizationTimeMs = 0;
    this.navigationTimeMs = 0;
    this.navigations = 0;
    this.peakQueueSize = 0;
    this.logger.debug('Metrics reset');
  }

  recordDiscovered(by = 1): void {
    this.discovered += by;
  }
  recordQueued(by = 1): void {
    this.queued += by;
  }
  recordExtracted(durationMs = 0): void {
    this.extracted++;
    this.extractionTimeMs += durationMs;
  }
  recordNormalized(durationMs = 0): void {
    this.normalized++;
    this.normalizationTimeMs += durationMs;
  }
  recordPersisted(): void {
    this.persisted++;
  }
  recordDuplicate(): void {
    this.duplicates++;
  }
  recordSkipped(): void {
    this.skipped++;
  }
  recordNavigation(latencyMs = 0): void {
    this.navigations++;
    this.navigationTimeMs += latencyMs;
  }

  recordFailurePermanent(): void {
    this.failed++;
  }
  recordRetry(): void {
    this.retries++;
  }
  recordNavigationFailure(): void {
    this.navigationFailures++;
  }
  recordExtractionFailure(): void {
    this.extractionFailures++;
  }
  recordNormalizationFailure(): void {
    this.normalizationFailures++;
  }

  /** Records the latest observed Scheduler queue depth, tracking the peak. */
  observeQueueDepth(depth: number): void {
    if (depth > this.peakQueueSize) this.peakQueueSize = depth;
  }

  /** Restores accumulator state from a persisted snapshot (after SW restart). */
  hydrate(m: IExtractionMetrics): void {
    this.sessionStart = m.sessionStart;
    this.crawlStartMs = Date.parse(m.sessionStart) || Date.now();
    this.discovered = m.discovered;
    this.queued = m.queued;
    this.extracted = m.extracted;
    this.normalized = m.normalized;
    this.persisted = m.persisted;
    this.duplicates = m.duplicates;
    this.skipped = m.skipped;
    this.failed = m.failed;
    this.retries = m.retries;
    this.navigationFailures = m.navigationFailures;
    this.extractionFailures = m.extractionFailures;
    this.normalizationFailures = m.normalizationFailures;
    this.extractionTimeMs = m.extractionTimeMs;
    this.normalizationTimeMs = m.normalizationTimeMs;
    this.navigationTimeMs = m.navigationTimeMs;
    // `navigations` is not persisted separately; reconstruct a safe lower bound
    // so averages remain meaningful after a restart.
    this.navigations = m.extracted;
    this.peakQueueSize = m.peakQueueSize;
  }

  snapshot(): IExtractionMetrics {
    const avg = (total: number, count: number): number =>
      count > 0 ? Math.round((total / count) * 10) / 10 : 0;

    return {
      sessionStart: this.sessionStart,
      sessionEnd: new Date().toISOString(),
      discovered: this.discovered,
      queued: this.queued,
      extracted: this.extracted,
      normalized: this.normalized,
      persisted: this.persisted,
      duplicates: this.duplicates,
      skipped: this.skipped,
      failed: this.failed,
      retries: this.retries,
      navigationFailures: this.navigationFailures,
      extractionFailures: this.extractionFailures,
      normalizationFailures: this.normalizationFailures,
      extractionTimeMs: this.extractionTimeMs,
      normalizationTimeMs: this.normalizationTimeMs,
      navigationTimeMs: this.navigationTimeMs,
      avgExtractionTime: avg(this.extractionTimeMs, this.extracted),
      avgNormalizationTime: avg(this.normalizationTimeMs, this.normalized),
      avgNavigationLatency: avg(this.navigationTimeMs, this.navigations),
      crawlDuration: Date.now() - this.crawlStartMs,
      peakQueueSize: this.peakQueueSize,
    };
  }
}
