/**
 * A structured snapshot of metrics collected during a single extraction session.
 * Emitted as a domain event at the end of a pipeline run.
 */
export interface IExtractionMetrics {
  /** ISO 8601 timestamp when the session started. */
  sessionStart: string;
  /** ISO 8601 timestamp when the session ended. */
  sessionEnd: string;
  /** Total number of resources found by the Discovery Engine. */
  discovered: number;
  /** Number of resources successfully extracted. */
  extracted: number;
  /** Number of resources skipped due to deduplication. */
  duplicates: number;
  /** Number of resources skipped due to feature flags or filters. */
  skipped: number;
  /** Number of resources that failed extraction or normalization. */
  failed: number;
  /** Total wall-clock time spent in extraction (ms). */
  extractionTimeMs: number;
  /** Total wall-clock time spent in normalization (ms). */
  normalizationTimeMs: number;
}
