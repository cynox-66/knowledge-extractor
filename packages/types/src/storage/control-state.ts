import { ICrawlSession } from '../connector/session.js';
import { ISessionReport } from '../diagnostics/diagnostics.js';

/**
 * Durable persistence contract for **runtime control state** — the data that
 * coordinates a crawl across service-worker eviction and browser restart, but
 * is conceptually distinct from the platform's domain aggregates (`IResource`,
 * which `IStorageEngine` owns).
 *
 * Control state covers:
 *  - the active crawl session (status + canonical metrics snapshot),
 *  - the scheduler queue and any other transient runtime state,
 *  - per-session diagnostic reports.
 *
 * Why a separate interface from `IStorageEngine`:
 *  1. The frozen `IStorageEngine` contract stays focused on domain aggregates.
 *  2. Each interface has one responsibility, mirroring `IMediaStore`'s split.
 *  3. Implementations co-exist: the same backing store (IndexedDB in the
 *     browser) can implement both contracts via one class, while a future
 *     desktop or cloud port can independently substitute either.
 *  4. Consumers (e.g. `SessionManager`) depend on the smallest surface they
 *     need, not on the resource-storage interface.
 *
 * The browser implementation backs this contract with IndexedDB stores
 * `sessions`, `crawlState`, and `diagnostics` — the same database that holds
 * resources, so cross-store atomic writes are possible in a single transaction.
 */
export interface IControlStateStore {
  // ---- Sessions -----------------------------------------------------------
  /** Persists a crawl session keyed by `session.sessionId`. */
  saveSession(session: ICrawlSession): Promise<void>;
  /** Retrieves a session by id, or null if absent. */
  getSession(sessionId: string): Promise<ICrawlSession | null>;
  /** Lists all persisted sessions (primarily for tooling / future history). */
  listSessions(): Promise<ICrawlSession[]>;

  // ---- Diagnostics --------------------------------------------------------
  /** Persists a diagnostic session report keyed by `report.sessionId`. */
  saveDiagnostics(report: ISessionReport): Promise<void>;
  /** Retrieves a diagnostic report by session id, or null if absent. */
  getDiagnostics(sessionId: string): Promise<ISessionReport | null>;

  // ---- Generic crawl state -----------------------------------------------
  /**
   * Persists an opaque crawl-state value under `key` (e.g. the scheduler queue
   * snapshot or the in-flight diagnostics collector state). The value must be
   * structured-clone-safe.
   */
  saveCrawlState(key: string, value: unknown): Promise<void>;
  /** Retrieves a crawl-state value, or null if absent. */
  getCrawlState<T = unknown>(key: string): Promise<T | null>;
  /** Removes a crawl-state value. Idempotent. */
  deleteCrawlState(key: string): Promise<void>;
}
