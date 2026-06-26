import { IResource } from '../core/resource.js';

/**
 * Represents a transactional unit of work against the storage engine.
 */
export interface ITransaction {
  /**
   * Commits the transaction, persisting all changes.
   */
  commit(): Promise<void>;
  /**
   * Rolls back the transaction, discarding all changes.
   */
  rollback(): Promise<void>;
}

/**
 * The unified storage abstraction.
 * Completely isolates the knowledge extraction engine from IndexedDB, SQLite, or Network APIs.
 */
export interface IStorageEngine {
  /**
   * Begins a new transaction.
   */
  beginTransaction(): Promise<ITransaction>;
  /**
   * Persists a resource to the storage engine.
   * If a transaction is provided, the save is deferred until commit.
   * @param resource The resource to save.
   * @param transaction The active transaction context.
   */
  saveResource(resource: IResource, transaction?: ITransaction): Promise<void>;
  /**
   * Retrieves a resource by its unique identifier.
   * @param id The global identifier.
   */
  getResourceById(id: string): Promise<IResource | null>;
  /**
   * Deletes a resource and its associated localized media.
   * @param id The global identifier.
   * @param transaction The active transaction context.
   */
  deleteResource(id: string, transaction?: ITransaction): Promise<void>;
}
