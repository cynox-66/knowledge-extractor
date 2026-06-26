/**
 * A structured snapshot of metrics collected during a single crawl session.
 * This is the canonical runtime metrics shape, produced by `MetricsCollector`
 * and embedded into the persisted `ICrawlSession`. The Popup reads these values;
 * it never maintains its own counters.
 */
export interface IExtractionMetrics {
  /** ISO 8601 timestamp when the session started. */
  sessionStart: string;
  /** ISO 8601 timestamp when the snapshot was taken (session "end" so far). */
  sessionEnd: string;

  // ---- Pipeline-stage counters --------------------------------------------
  /** Total number of resources found by the Discovery Engine. */
  discovered: number;
  /** Number of resources enqueued onto the Scheduler. */
  queued: number;
  /** Number of resources successfully extracted from the DOM. */
  extracted: number;
  /** Number of resources successfully normalized into the domain model. */
  normalized: number;
  /** Number of resources successfully persisted to storage. */
  persisted: number;
  /** Number of resources skipped due to deduplication. */
  duplicates: number;
  /** Number of resources skipped due to feature flags or filters. */
  skipped: number;

  // ---- Failure counters ----------------------------------------------------
  /** Number of resources that permanently failed (exhausted retries). */
  failed: number;
  /** Total retry attempts scheduled across all tasks. */
  retries: number;
  /** Failures that occurred during navigation (opening the resource). */
  navigationFailures: number;
  /** Failures that occurred during extraction (DOM parsing). */
  extractionFailures: number;
  /** Failures that occurred during normalization. */
  normalizationFailures: number;

  // ---- Timing totals (ms) --------------------------------------------------
  /** Total wall-clock time spent in extraction (ms). */
  extractionTimeMs: number;
  /** Total wall-clock time spent in normalization (ms). */
  normalizationTimeMs: number;
  /** Total wall-clock time spent navigating/opening resources (ms). */
  navigationTimeMs: number;

  // ---- Derived aggregates --------------------------------------------------
  /** Mean extraction time per extracted resource (ms). */
  avgExtractionTime: number;
  /** Mean normalization time per normalized resource (ms). */
  avgNormalizationTime: number;
  /** Mean navigation latency per opened resource (ms). */
  avgNavigationLatency: number;
  /** Total elapsed crawl duration so far (ms). */
  crawlDuration: number;
  /** Highest observed Scheduler queue depth during the crawl. */
  peakQueueSize: number;
}
