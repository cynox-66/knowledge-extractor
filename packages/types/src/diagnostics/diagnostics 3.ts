import { IExtractionMetrics } from '@knowledge-extractor/types';

/** Classification of a single extraction failure. */
export type FailureCategory =
  | 'selector_failure'
  | 'parsing_failure'
  | 'normalization_failure'
  | 'network_error'
  | 'unknown';

/** A structured record of one failed extraction. */
export interface IFailureRecord {
  /** ISO 8601 timestamp. */
  timestamp: string;
  /** The URL of the resource that failed. */
  targetUri: string;
  /** Failure classification. */
  category: FailureCategory;
  /** Human-readable root cause description. */
  rootCause: string;
  /** The error message or stack if available. */
  errorDetail?: string;
  /**
   * A minimal DOM snapshot of the article element that triggered the failure.
   * Trimmed to the first 2000 characters to avoid memory bloat.
   */
  domSnapshot?: string;
  /** The strategy name that was active when the failure occurred, if applicable. */
  failingStrategy?: string;
}

/** Full diagnostic report for one extraction session. */
export interface ISessionReport {
  sessionId: string;
  startedAt: string;
  endedAt: string;
  pageUrl: string;
  metrics: IExtractionMetrics;
  failures: IFailureRecord[];
  strategyUsage: Record<string, number>;
  memoryUsageMb?: number;
}
