import {
  IStorageEngine,
  ITransaction,
  IResource,
  ICrawlSession,
  ISessionReport,
} from '@knowledge-extractor/types';
import { Logger } from '@knowledge-extractor/shared';
import { openDatabase, readRecord, listRecords, writeRecord, deleteRecord } from './database.js';
import { STORES } from './schema.js';
import { BufferedTransaction } from './transaction.js';

/**
 * Durable, IndexedDB-backed implementation of {@link IStorageEngine}.
 *
 * Resources are the primary domain entity (the frozen `IStorageEngine`
 * contract). The same database also persists sessions, diagnostics, and generic
 * crawl state via typed auxiliary methods, so all crawl data survives both
 * service-worker eviction and full browser restart. These auxiliary methods are
 * additive to the concrete class; they do not change the `IStorageEngine`
 * interface and are wired into the subsystems in Beta-0 Phase 3.
 *
 * The connection is opened lazily and memoized.
 */
export class IndexedDbStorageEngine implements IStorageEngine {
  private readonly logger = new Logger('IndexedDbStorage');
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly dbName?: string,
    private readonly dbVersion?: number,
  ) {}

  /** Opens (once) and returns the database connection. */
  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = openDatabase(this.dbName, this.dbVersion);
    }
    return this.dbPromise;
  }

  /** Eagerly opens the connection (optional; useful at startup). */
  async init(): Promise<void> {
    await this.db();
  }

  /** Closes the connection (primarily for tests / teardown). */
  async close(): Promise<void> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      db.close();
      this.dbPromise = null;
    }
  }

  // ---- IStorageEngine (resources) ------------------------------------------

  async beginTransaction(): Promise<ITransaction> {
    const db = await this.db();
    return new BufferedTransaction(db);
  }

  async saveResource(resource: IResource, transaction?: ITransaction): Promise<void> {
    if (transaction) {
      this.asBuffered(transaction).put(STORES.RESOURCES, resource);
      return;
    }
    const db = await this.db();
    await writeRecord(db, STORES.RESOURCES, resource);
    this.logger.debug(`Saved resource ${resource.id}`);
  }

  async getResourceById(id: string): Promise<IResource | null> {
    const db = await this.db();
    return readRecord<IResource>(db, STORES.RESOURCES, id);
  }

  async deleteResource(id: string, transaction?: ITransaction): Promise<void> {
    if (transaction) {
      this.asBuffered(transaction).delete(STORES.RESOURCES, id);
      return;
    }
    const db = await this.db();
    await deleteRecord(db, STORES.RESOURCES, id);
    this.logger.debug(`Deleted resource ${id}`);
  }

  /** Lists every persisted resource (primarily for tooling/tests). */
  async listResources(): Promise<IResource[]> {
    const db = await this.db();
    return listRecords<IResource>(db, STORES.RESOURCES);
  }

  // ---- Auxiliary stores (wired into subsystems in Phase 3) -----------------

  async saveSession(session: ICrawlSession): Promise<void> {
    const db = await this.db();
    await writeRecord(db, STORES.SESSIONS, session);
  }

  async getSession(sessionId: string): Promise<ICrawlSession | null> {
    const db = await this.db();
    return readRecord<ICrawlSession>(db, STORES.SESSIONS, sessionId);
  }

  async listSessions(): Promise<ICrawlSession[]> {
    const db = await this.db();
    return listRecords<ICrawlSession>(db, STORES.SESSIONS);
  }

  async saveDiagnostics(report: ISessionReport): Promise<void> {
    const db = await this.db();
    await writeRecord(db, STORES.DIAGNOSTICS, report);
  }

  async getDiagnostics(sessionId: string): Promise<ISessionReport | null> {
    const db = await this.db();
    return readRecord<ISessionReport>(db, STORES.DIAGNOSTICS, sessionId);
  }

  /** Persists a generic crawl-state value (e.g. the scheduler queue snapshot). */
  async saveCrawlState(key: string, value: unknown): Promise<void> {
    const db = await this.db();
    await writeRecord(db, STORES.CRAWL_STATE, { key, value });
  }

  async getCrawlState<T = unknown>(key: string): Promise<T | null> {
    const db = await this.db();
    const record = await readRecord<{ key: string; value: T }>(db, STORES.CRAWL_STATE, key);
    return record ? record.value : null;
  }

  async deleteCrawlState(key: string): Promise<void> {
    const db = await this.db();
    await deleteRecord(db, STORES.CRAWL_STATE, key);
  }

  private asBuffered(transaction: ITransaction): BufferedTransaction {
    if (!(transaction instanceof BufferedTransaction)) {
      throw new Error('IndexedDbStorageEngine requires a transaction from beginTransaction()');
    }
    return transaction;
  }
}
