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
 * CrawlSession tracking for the Background Worker.
 */
export interface ICrawlSession {
  sessionId: string;
  startedAt: string;
  discovered: number;
  queued: number;
  extracted: number;
  failed: number;
  currentResource?: string;
  isRunning: boolean;
  isPaused: boolean;
  isCancelled: boolean;
}
