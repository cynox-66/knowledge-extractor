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

  clear(): void {
    this.tasks.clear();
  }
}
