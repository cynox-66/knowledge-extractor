import { ICrawlTask, TaskState } from '@knowledge-extractor/types';
import { Logger } from '@knowledge-extractor/shared';

export interface SchedulerOptions {
  maxAttempts: number;
  baseBackoffMs: number;
}

export class Scheduler {
  private readonly logger = new Logger('Scheduler');
  private tasks = new Map<string, ICrawlTask>();
  private readonly opts: SchedulerOptions;

  constructor(opts: Partial<SchedulerOptions> = {}) {
    this.opts = {
      maxAttempts: opts.maxAttempts ?? 3,
      baseBackoffMs: opts.baseBackoffMs ?? 1000,
    };
  }

  enqueue(targetUri: string, priority = 0): ICrawlTask | null {
    if (this.tasks.has(targetUri)) {
      return null; // Already tracked
    }

    const task: ICrawlTask = {
      id: targetUri,
      targetUri,
      state: TaskState.QUEUED,
      priority,
      attempts: 0,
      maxAttempts: this.opts.maxAttempts,
    };

    this.tasks.set(targetUri, task);
    this.logger.debug(`Enqueued task: ${targetUri} (Priority: ${priority})`);
    return task;
  }

  /**
   * Retrieves the next task ready for extraction.
   * Tasks with nextRetryAt > now are skipped.
   * Tasks are sorted by priority (descending).
   */
  getNextTask(): ICrawlTask | null {
    const now = Date.now();

    const readyTasks = Array.from(this.tasks.values()).filter(
      (t) => t.state === TaskState.QUEUED && (!t.nextRetryAt || t.nextRetryAt <= now),
    );

    if (readyTasks.length === 0) return null;

    readyTasks.sort((a, b) => b.priority - a.priority);

    const task = readyTasks[0];
    task.state = TaskState.OPENING;
    return task;
  }

  markExtracting(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (task) task.state = TaskState.EXTRACTING;
  }

  markCompleted(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (task) task.state = TaskState.COMPLETED;
  }

  markFailed(taskId: string, error: string): ICrawlTask | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    task.attempts += 1;
    task.lastError = error;

    if (task.attempts >= task.maxAttempts) {
      task.state = TaskState.FAILED;
      this.logger.warn(`Task permanently failed: ${taskId}`);
    } else {
      task.state = TaskState.QUEUED;
      const backoff = this.opts.baseBackoffMs * Math.pow(2, task.attempts - 1);
      task.nextRetryAt = Date.now() + backoff;
      this.logger.info(`Task scheduled for retry in ${backoff}ms: ${taskId}`);
    }

    return task;
  }

  getPendingCount(): number {
    return Array.from(this.tasks.values()).filter((t) => t.state === TaskState.QUEUED).length;
  }

  /** Current queue depth (tasks awaiting processing). Alias of getPendingCount. */
  getQueueDepth(): number {
    return this.getPendingCount();
  }

  /** True when no task remains in a non-terminal state (queued/opening/extracting). */
  isDrained(): boolean {
    for (const t of this.tasks.values()) {
      if (
        t.state === TaskState.QUEUED ||
        t.state === TaskState.OPENING ||
        t.state === TaskState.EXTRACTING
      ) {
        return false;
      }
    }
    return true;
  }

  /**
   * Serializes the full task map for persistence. `ICrawlTask` is a plain
   * data shape, so this is a structured-clone-safe snapshot that preserves
   * attempts, backoff (`nextRetryAt`), priorities, and last error.
   */
  snapshot(): ICrawlTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Rehydrates the queue from a persisted snapshot after a service-worker
   * restart. Any task left mid-flight (OPENING/EXTRACTING) when the worker was
   * suspended is reset to QUEUED so it is retried rather than lost.
   */
  restore(tasks: ICrawlTask[]): void {
    this.tasks.clear();
    for (const task of tasks) {
      if (task.state === TaskState.OPENING || task.state === TaskState.EXTRACTING) {
        task.state = TaskState.QUEUED;
      }
      this.tasks.set(task.id, task);
    }
    this.logger.info(`Scheduler restored ${this.tasks.size} task(s) from snapshot`);
  }

  clear(): void {
    this.tasks.clear();
  }
}
