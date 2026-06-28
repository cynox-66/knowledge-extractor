import { ITransaction } from '@knowledge-extractor/types';
import { awaitTransaction } from './database.js';
import type { StoreName } from './schema.js';

/** A single buffered write operation, applied atomically on commit. */
type BufferedOp =
  | { kind: 'put'; store: StoreName; value: unknown }
  | { kind: 'delete'; store: StoreName; key: IDBValidKey };

/**
 * A buffered unit-of-work transaction implementing the platform `ITransaction`.
 *
 * IndexedDB transactions auto-close once the microtask queue drains, so they
 * cannot be held open across the `await`s between `beginTransaction()`,
 * `saveResource(tx)`, and `commit()` that the engine's callers use. Instead,
 * operations are buffered in memory and flushed inside a single native
 * readwrite transaction at {@link commit}, giving true atomicity: if any write
 * fails the native transaction aborts and nothing is persisted.
 *
 * `rollback()` simply discards the buffer (nothing was written yet).
 */
export class BufferedTransaction implements ITransaction {
  private readonly ops: BufferedOp[] = [];
  private settled = false;

  constructor(private readonly db: IDBDatabase) {}

  /** Buffers a put (insert/update) into the given store. */
  put(store: StoreName, value: unknown): void {
    this.assertOpen();
    this.ops.push({ kind: 'put', store, value });
  }

  /** Buffers a delete by key from the given store. */
  delete(store: StoreName, key: IDBValidKey): void {
    this.assertOpen();
    this.ops.push({ kind: 'delete', store, key });
  }

  /** Number of buffered operations not yet committed (for diagnostics/tests). */
  get size(): number {
    return this.ops.length;
  }

  /**
   * Flushes all buffered operations inside one native readwrite transaction.
   * Resolves only once the transaction has durably committed; on any error the
   * native transaction aborts and the rejection propagates (atomic all-or-nothing).
   */
  async commit(): Promise<void> {
    this.assertOpen();
    this.settled = true;
    if (this.ops.length === 0) return;

    const stores = [...new Set(this.ops.map((op) => op.store))];
    const tx = this.db.transaction(stores, 'readwrite');
    for (const op of this.ops) {
      const objectStore = tx.objectStore(op.store);
      if (op.kind === 'put') objectStore.put(op.value);
      else objectStore.delete(op.key);
    }
    await awaitTransaction(tx);
  }

  /** Discards all buffered operations without writing. */
  async rollback(): Promise<void> {
    this.settled = true;
    this.ops.length = 0;
    return Promise.resolve();
  }

  private assertOpen(): void {
    if (this.settled) {
      throw new Error('Transaction already committed or rolled back');
    }
  }
}
