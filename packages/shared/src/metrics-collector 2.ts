import { IExtractionMetrics } from '@knowledge-extractor/types';
import { Logger } from './logger';

/**
 * Accumulates runtime metrics during an extraction session and emits
 * them as a structured snapshot on demand.
 */
export class MetricsCollector {
  private readonly logger = new Logger('MetricsCollector');
  private sessionStart: string = new Date().toISOString();
  private discovered = 0;
  private extracted = 0;
  private duplicates = 0;
  private skipped = 0;
  private failed = 0;
  private extractionTimeMs = 0;
  private normalizationTimeMs = 0;

  reset(): void {
    this.sessionStart = new Date().toISOString();
    this.discovered = 0;
    this.extracted = 0;
    this.duplicates = 0;
    this.skipped = 0;
    this.failed = 0;
    this.extractionTimeMs = 0;
    this.normalizationTimeMs = 0;
  }

  recordDiscovered(): void {
    this.discovered++;
  }
  recordExtracted(): void {
    this.extracted++;
  }
  recordDuplicate(): void {
    this.duplicates++;
  }
  recordSkipped(): void {
    this.skipped++;
  }
  recordFailed(): void {
    this.failed++;
  }
  addExtractionTime(ms: number): void {
    this.extractionTimeMs += ms;
  }
  addNormalizationTime(ms: number): void {
    this.normalizationTimeMs += ms;
  }

  snapshot(): IExtractionMetrics {
    const metrics: IExtractionMetrics = {
      sessionStart: this.sessionStart,
      sessionEnd: new Date().toISOString(),
      discovered: this.discovered,
      extracted: this.extracted,
      duplicates: this.duplicates,
      skipped: this.skipped,
      failed: this.failed,
      extractionTimeMs: this.extractionTimeMs,
      normalizationTimeMs: this.normalizationTimeMs,
    };
    this.logger.info('Metrics snapshot', metrics);
    return metrics;
  }
}
