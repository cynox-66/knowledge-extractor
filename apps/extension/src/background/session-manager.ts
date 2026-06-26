import { ICrawlSession } from '@knowledge-extractor/types';
import { Logger, MetricsCollector } from '@knowledge-extractor/shared';

/**
 * Single source of truth for crawl state. Persists `ICrawlSession` to
 * `chrome.storage.local` so it survives popup closure, service-worker
 * suspension, **and full browser restart** (Beta-0 Phase 3), and broadcasts
 * `SESSION_UPDATED` so the (stateless) Popup can live-render. All numeric
 * counters are sourced from `MetricsCollector`; this class does not maintain
 * its own.
 */
export class SessionManager {
  private readonly logger = new Logger('SessionManager');
  private readonly STORAGE_KEY = 'crawl_session';
  private session: ICrawlSession | null = null;

  constructor(private readonly metrics: MetricsCollector) {}

  /**
   * Loads any persisted session. If one exists, its metrics snapshot is used to
   * rehydrate the canonical `MetricsCollector` so counters survive restart.
   */
  async init(): Promise<void> {
    const data = await chrome.storage.local.get(this.STORAGE_KEY);
    const stored = data[this.STORAGE_KEY] as ICrawlSession | undefined;
    if (stored) {
      this.session = stored;
      this.metrics.hydrate(stored.metrics);
      this.logger.info(`Restored existing session: ${stored.sessionId}`);
    } else {
      this.session = this.createEmptySession();
      await this.persist();
      this.logger.info(`Created new session: ${this.session.sessionId}`);
    }
  }

  startNewSession(): ICrawlSession {
    this.metrics.reset();
    this.session = this.createEmptySession();
    this.session.isRunning = true;
    void this.persist();
    return this.session;
  }

  getSession(): ICrawlSession | null {
    return this.session;
  }

  /** Patches execution-status fields and re-persists (refreshing metrics). */
  async update(patch: Partial<ICrawlSession>): Promise<void> {
    if (!this.session) return;
    this.session = { ...this.session, ...patch };
    await this.persist();
  }

  /** Pushes the latest metrics snapshot (and queue depth) into the session. */
  async sync(queueDepth: number): Promise<void> {
    if (!this.session) return;
    this.session.queueDepth = queueDepth;
    await this.persist();
  }

  private createEmptySession(): ICrawlSession {
    return {
      sessionId: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      isRunning: false,
      isPaused: false,
      isCancelled: false,
      currentResource: '',
      navigationStatus: 'idle',
      queueDepth: 0,
      metrics: this.metrics.snapshot(),
    };
  }

  /**
   * Persists the session, always embedding the freshest metrics snapshot so the
   * stored state and the Popup never diverge from the canonical collector.
   */
  private async persist(): Promise<void> {
    if (!this.session) return;
    this.session.metrics = this.metrics.snapshot();
    await chrome.storage.local.set({ [this.STORAGE_KEY]: this.session });
    // Broadcast to any open popups (ignored if none are listening).
    chrome.runtime.sendMessage({ action: 'SESSION_UPDATED', data: this.session }).catch(() => {});
  }
}
