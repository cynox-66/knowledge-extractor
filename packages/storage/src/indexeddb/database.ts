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
