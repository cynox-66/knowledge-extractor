/**
 * Defines the execution states of a background job.
 */
export enum JobStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  RETRIED = 'retried',
}

/**
 * A Job is a first-class domain concept representing an asynchronous unit of work
 * orchestrating the transition of a Resource through its lifecycle.
 */
export interface IJob<TPayload = unknown, TResult = unknown> {
  /**
   * The unique identifier for the job.
   */
  id: string;
  /**
   * The classification of the work to be performed.
   */
  type: string;
  /**
   * The current execution status of the job.
   */
  status: JobStatus;
  /**
   * The input payload required to execute the job.
   */
  payload: TPayload;
  /**
   * The output generated upon successful completion.
   */
  result?: TResult;
  /**
   * An error message or stack trace if the job failed.
   */
  error?: string;
  /**
   * The number of times this job has been attempted.
   */
  attempts: number;
  /**
   * The timestamp indicating when the job was initially created.
   */
  createdAt: string;
  /**
   * The timestamp indicating when the job was last updated.
   */
  updatedAt: string;
}
