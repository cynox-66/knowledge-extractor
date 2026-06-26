export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

/**
 * Shared logging abstraction. Ensures all subsystems log uniformly
 * without calling console.log directly.
 */
export class Logger {
  private level: LogLevel = LogLevel.DEBUG;
  private context: string;

  constructor(context: string) {
    this.context = context;
  }

  public setLevel(level: LogLevel): void {
    this.level = level;
  }

  public debug(message: string, meta?: unknown): void {
    if (this.level <= LogLevel.DEBUG) {
      console.debug(`[DEBUG] [${this.context}] ${message}`, meta ?? '');
    }
  }

  public info(message: string, meta?: unknown): void {
    if (this.level <= LogLevel.INFO) {
      console.info(`[INFO] [${this.context}] ${message}`, meta ?? '');
    }
  }

  public warn(message: string, meta?: unknown): void {
    if (this.level <= LogLevel.WARN) {
      console.warn(`[WARN] [${this.context}] ${message}`, meta ?? '');
    }
  }

  public error(message: string, error?: unknown): void {
    if (this.level <= LogLevel.ERROR) {
      console.error(`[ERROR] [${this.context}] ${message}`, error ?? '');
    }
  }
}
