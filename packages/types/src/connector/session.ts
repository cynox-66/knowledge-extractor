import { IExtractionMetrics } from './metrics.js';

/**
 * Defines the execution state of a single CrawlTask.
 */
export enum TaskState {
  QUEUED = 'queued',
  OPENING = 'opening',
  EXTRACTING = 'extracting',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

/**
 * A scheduled extraction task owned by the Scheduler.
 * Decoupled from the domain resource it produces.
 */
export interface ICrawlTask {
  /**
   * Unique ID for the task (often the fingerprint or target URI).
   */
  id: string;
  /**
   * The URI to be extracted.
   */
  targetUri: string;
  /**
   * Current execution state.
   */
  state: TaskState;
  /**
   * Priority (higher number = higher priority).
   */
  priority: number;
  /**
   * Number of attempts so far.
   */
  attempts: number;
  /**
   * Max allowed attempts before transitioning to FAILED.
   */
  maxAttempts: number;
  /**
   * Next allowed execution time (epoch ms) for exponential backoff.
   */
  nextRetryAt?: number;
  /**
   * Last observed error message, if any.
   */
  lastError?: string;
}

/**
 * The persisted crawl session — the single source of truth for the Background
 * Worker and the (stateless) Popup. Stored in `chrome.storage.session` so it
 * survives popup closure and service-worker suspension.
 *
 * Execution status lives here; all numeric counters live in `metrics`
 * (sourced canonically from `MetricsCollector`) and are never duplicated.
 */
export interface ICrawlSession {
  sessionId: string;
  startedAt: string;

  // ---- Execution status ----------------------------------------------------
  isRunning: boolean;
  isPaused: boolean;
  isCancelled: boolean;
  /** The URI currently being processed ('' = none). */
  currentResource: string;
  /** Human-readable pipeline stage for the current resource (e.g. 'opening'). */
  navigationStatus: string;
  /** Current Scheduler queue depth (pending tasks awaiting processing). */
  queueDepth: number;

  // ---- Canonical metrics snapshot -----------------------------------------
  metrics: IExtractionMetrics;
}
