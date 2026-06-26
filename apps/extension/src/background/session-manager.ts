import { ICrawlSession } from '@knowledge-extractor/types';
import { Logger } from '@knowledge-extractor/shared';

/**
 * Manages the persistent state of a crawl session using chrome.storage.session.
 * The popup dashboard reads this state.
 */
export class SessionManager {
  private readonly logger = new Logger('SessionManager');
  private readonly STORAGE_KEY = 'crawl_session';
  private session: ICrawlSession | null = null;

  async init(): Promise<void> {
    const data = await chrome.storage.session.get(this.STORAGE_KEY);
    if (data[this.STORAGE_KEY]) {
      this.session = data[this.STORAGE_KEY] as ICrawlSession;
      this.logger.info(`Restored existing session: ${this.session.sessionId}`);
    } else {
      this.session = this.createEmptySession();
      await this.persist();
      this.logger.info(`Created new session: ${this.session.sessionId}`);
    }
  }

  startNewSession(): ICrawlSession {
    this.session = this.createEmptySession();
    this.session.isRunning = true;
    this.persist();
    return this.session;
  }

  getSession(): ICrawlSession | null {
    return this.session;
  }

  async update(patch: Partial<ICrawlSession>): Promise<void> {
    if (!this.session) return;
    this.session = { ...this.session, ...patch };
    await this.persist();
  }

  async increment(field: 'discovered' | 'queued' | 'extracted' | 'failed', by = 1): Promise<void> {
    if (!this.session) return;
    this.session[field] += by;
    await this.persist();
  }

  private createEmptySession(): ICrawlSession {
    return {
      sessionId: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      discovered: 0,
      queued: 0,
      extracted: 0,
      failed: 0,
      isRunning: false,
      isPaused: false,
      isCancelled: false,
    };
  }

  private async persist(): Promise<void> {
    if (!this.session) return;
    await chrome.storage.session.set({ [this.STORAGE_KEY]: this.session });

    // Broadcast status to any open popups
    chrome.runtime.sendMessage({ action: 'SESSION_UPDATED', data: this.session }).catch(() => {});
  }
}
