import { Logger } from '@knowledge-extractor/shared';
import {
  DB_NAME,
  DB_VERSION,
  MIGRATIONS,
  META_VERSION_KEY,
  STORES,
  type StoreName,
} from './schema.js';

/**
 * Wraps an `IDBRequest` in a Promise that resolves with its result or rejects
 * with its error.
 */
export function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

/**
 * Resolves when an `IDBTransaction` completes, or rejects if it aborts/errors.
 * This is how atomicity is observed: the returned promise only resolves once
 * every write in the transaction has durably committed.
 */
export function awaitTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction error'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

const logger = new Logger('IndexedDb');

/**
 * Opens (and upgrades, if needed) the durable database. Migrations in
 * {@link MIGRATIONS} run synchronously inside `onupgradeneeded`; the resulting
 * schema version is mirrored into the `meta` store after the connection opens.
 *
 * @param name Database name override (used by tests for isolation).
 * @param version Schema version override (used by tests).
 */
export async function openDatabase(name = DB_NAME, version = DB_VERSION): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB is not available in this environment');
  }

  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, version);

    request.onupgradeneeded = (event) => {
      const database = request.result;
      const transaction = request.transaction;
      if (!transaction) {
        reject(new Error('Missing upgrade transaction'));
        return;
      }
      const oldVersion = event.oldVersion;
      for (const migration of MIGRATIONS) {
        if (oldVersion < migration.version && migration.version <= version) {
          logger.info(`Applying migration v${migration.version}: ${migration.description}`);
          migration.apply(database, transaction);
        }
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
    request.onblocked = () => logger.warn('IndexedDB open blocked by another connection');
  });

  // Mirror the schema version into the meta store for observability.
  await writeMeta(db, META_VERSION_KEY, version);
  logger.info(`Database "${name}" opened at schema version ${version}`);
  return db;
}

/** Writes a key/value pair into the `meta` store in its own transaction. */
async function writeMeta(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  const tx = db.transaction(STORES.META, 'readwrite');
  tx.objectStore(STORES.META).put({ key, value, updatedAt: new Date().toISOString() });
  await awaitTransaction(tx);
}

/** Reads a single record by key from a store (readonly transaction). */
export async function readRecord<T>(
  db: IDBDatabase,
  store: StoreName,
  key: IDBValidKey,
): Promise<T | null> {
  const tx = db.transaction(store, 'readonly');
  const result = await promisifyRequest<T | undefined>(tx.objectStore(store).get(key));
  return result ?? null;
}

/** Lists all records in a store (readonly transaction). */
export async function listRecords<T>(db: IDBDatabase, store: StoreName): Promise<T[]> {
  const tx = db.transaction(store, 'readonly');
  return promisifyRequest<T[]>(tx.objectStore(store).getAll());
}

/** Counts records in a store (readonly transaction). */
export async function countRecords(db: IDBDatabase, store: StoreName): Promise<number> {
  const tx = db.transaction(store, 'readonly');
  return promisifyRequest<number>(tx.objectStore(store).count());
}

/** Writes a single record into a store in its own transaction. */
export async function writeRecord(
  db: IDBDatabase,
  store: StoreName,
  value: unknown,
): Promise<void> {
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  await awaitTransaction(tx);
}

/** Deletes a single record by key from a store in its own transaction. */
export async function deleteRecord(
  db: IDBDatabase,
  store: StoreName,
  key: IDBValidKey,
): Promise<void> {
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  await awaitTransaction(tx);
}

/**
 * Paginated cursor query over a secondary index.
 *
 * Opens a readonly cursor on `indexName` filtered to `indexValue` and collects
 * up to `pageSize` records. When `afterId` is provided (the primary key of the
 * last item from the previous page), the cursor seeks to that position and
 * advances one step past it before collecting. If the record identified by
 * `afterId` has been deleted since the previous page was fetched, the cursor
 * lands on the first surviving record after that key — no items are skipped.
 *
 * Items are returned in primary-key (lexicographic) order within the index key.
 *
 * @param T  Record type; must expose an `id: string` primary key field.
 */
/**
 * Paginates an entire object store by primary key — the state-agnostic
 * counterpart to {@link queryByIndex}. Returns one page in primary-key order,
 * starting strictly after `afterId` when supplied. Used to enumerate resources
 * across all lifecycle states (e.g. exporting everything persisted).
 *
 * @param T  Record type; must expose an `id: string` primary key field.
 */
export function queryByKey<T extends { id: string }>(
  db: IDBDatabase,
  store: StoreName,
  pageSize: number,
  afterId?: string,
): Promise<{ items: T[]; nextCursor?: string; hasMore: boolean }> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    // Start strictly after the previous page's last key (exclusive lower bound).
    const range = afterId !== undefined ? IDBKeyRange.lowerBound(afterId, true) : undefined;
    const req = tx.objectStore(store).openCursor(range);

    const items: T[] = [];
    let done = false;

    req.onsuccess = () => {
      if (done) return;
      const cursor = req.result;
      if (!cursor) {
        resolve({ items, hasMore: false });
        return;
      }
      if (items.length < pageSize) {
        items.push(cursor.value as T);
        cursor.continue();
      } else {
        // Cursor sits on the (pageSize + 1)-th record → more pages remain.
        resolve({ items, nextCursor: items[items.length - 1].id, hasMore: true });
        done = true;
      }
    };

    req.onerror = () => reject(req.error ?? new Error('Key cursor query failed'));
  });
}

export function queryByIndex<T extends { id: string }>(
  db: IDBDatabase,
  store: StoreName,
  indexName: string,
  indexValue: IDBValidKey,
  pageSize: number,
  afterId?: string,
): Promise<{ items: T[]; nextCursor?: string; hasMore: boolean }> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const index = tx.objectStore(store).index(indexName);
    const req = index.openCursor(IDBKeyRange.only(indexValue));

    const items: T[] = [];
    // phase drives the state machine across successive onsuccess callbacks.
    // seek → (continuePrimaryKey issued) → skip → (cursor verified / advanced) → collect → done
    let phase: 'seek' | 'skip' | 'collect' | 'done' = afterId !== undefined ? 'seek' : 'collect';

    req.onsuccess = () => {
      const cursor = req.result;

      if (phase === 'done') return;

      if (!cursor) {
        resolve({ items, hasMore: false });
        return;
      }

      if (phase === 'seek') {
        // continuePrimaryKey advances to the first record where
        // (indexKey, primaryKey) >= (indexValue, afterId).
        cursor.continuePrimaryKey(indexValue, afterId!);
        phase = 'skip';
        return;
      }

      if (phase === 'skip') {
        phase = 'collect';
        if (String(cursor.primaryKey) === afterId) {
          // Cursor landed exactly on the already-seen record; step past it.
          cursor.continue();
          return;
        }
        // afterId no longer exists; cursor is already past it — fall through.
      }

      // phase === 'collect'
      if (items.length < pageSize) {
        items.push(cursor.value as T);
        cursor.continue();
      } else {
        // items is full and cursor is at the (pageSize + 1)-th record,
        // confirming there are more pages.
        resolve({
          items,
          nextCursor: items[items.length - 1].id,
          hasMore: true,
        });
        phase = 'done';
      }
    };

    req.onerror = () => reject(req.error ?? new Error('Index cursor query failed'));
  });
}
