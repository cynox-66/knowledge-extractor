import {
  IFailureRecord,
  ISessionReport,
  FailureCategory,
  IExtractionMetrics,
} from '@knowledge-extractor/types';
import { Logger } from './logger.js';

/**
 * Accumulates all diagnostic data for a single extraction session.
 * Lives in the Background Worker and is reset on each pipeline start.
 */
export class DiagnosticsCollector {
  private readonly logger = new Logger('DiagnosticsCollector');
  private sessionId: string = crypto.randomUUID();
  private startedAt: string = new Date().toISOString();
  private pageUrl: string = '';
  private failures: IFailureRecord[] = [];
  private strategyUsage: Record<string, number> = {};

  reset(pageUrl: string): void {
    this.sessionId = crypto.randomUUID();
    this.startedAt = new Date().toISOString();
    this.pageUrl = pageUrl;
    this.failures = [];
    this.strategyUsage = {};
    this.logger.info(`Diagnostic session started: ${this.sessionId}`);
  }

  recordFailure(
    targetUri: string,
    category: FailureCategory,
    rootCause: string,
    opts?: {
      errorDetail?: string;
      domSnapshot?: string;
      failingStrategy?: string;
    },
  ): void {
    const record: IFailureRecord = {
      timestamp: new Date().toISOString(),
      targetUri,
      category,
      rootCause,
    };
    if (opts?.errorDetail) record.errorDetail = opts.errorDetail;
    if (opts?.domSnapshot) record.domSnapshot = opts.domSnapshot.slice(0, 2000);
    if (opts?.failingStrategy) record.failingStrategy = opts.failingStrategy;
    this.failures.push(record);
    this.logger.warn(`Failure recorded [${category}]: ${rootCause}`, { targetUri });
  }

  recordStrategyUsed(strategyName: string): void {
    this.strategyUsage[strategyName] = (this.strategyUsage[strategyName] ?? 0) + 1;
  }

  buildReport(metrics: IExtractionMetrics): ISessionReport {
    // Read memory if available (Chrome extensions have performance.memory in some contexts)
    let memoryUsageMb: number | undefined;
    if (typeof performance !== 'undefined' && 'memory' in performance) {
      const mem = (performance as unknown as { memory: { usedJSHeapSize: number } }).memory;
      memoryUsageMb = Math.round((mem.usedJSHeapSize / 1024 / 1024) * 10) / 10;
    }

    const report: ISessionReport = {
      sessionId: this.sessionId,
      startedAt: this.startedAt,
      endedAt: new Date().toISOString(),
      pageUrl: this.pageUrl,
      metrics,
      failures: this.failures,
      strategyUsage: this.strategyUsage,
    };
    if (memoryUsageMb !== undefined) {
      report.memoryUsageMb = memoryUsageMb;
    }
    return report;
  }

  getFailures(): IFailureRecord[] {
    return [...this.failures];
  }
}
