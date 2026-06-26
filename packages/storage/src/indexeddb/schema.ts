/**
 * IndexedDB schema definition for the Knowledge Extractor durable store.
 *
 * The schema is versioned. Each bump appends a migration to {@link MIGRATIONS};
 * migrations run in order inside `onupgradeneeded`. The current version is also
 * mirrored into the `meta` store for observability and cross-checking.
 */

/** The IndexedDB database name (single database for the whole platform). */
export const DB_NAME = 'knowledge-extractor';

/** The current schema version. Bump this whenever a migration is added. */
export const DB_VERSION = 1;

/**
 * Object store names. Each store is keyed by an in-record property (keyPath),
 * so values are plain objects with no external key management.
 */
export const STORES = {
  /** Normalized domain resources (`IResource`), keyed by `id`. */
  RESOURCES: 'resources',
  /** Persisted crawl sessions (`ICrawlSession`), keyed by `sessionId`. */
  SESSIONS: 'sessions',
  /** Diagnostic session reports (`ISessionReport`), keyed by `sessionId`. */
  DIAGNOSTICS: 'diagnostics',
  /** Generic crawl/runtime state (e.g. scheduler queue), keyed by `key`. */
  CRAWL_STATE: 'crawlState',
  /** Internal metadata (schema version, migration log), keyed by `key`. */
  META: 'meta',
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

/** The keyPath used by each store. */
export const STORE_KEYPATHS: Record<StoreName, string> = {
  [STORES.RESOURCES]: 'id',
  [STORES.SESSIONS]: 'sessionId',
  [STORES.DIAGNOSTICS]: 'sessionId',
  [STORES.CRAWL_STATE]: 'key',
  [STORES.META]: 'key',
};

/** Key under which the schema version is mirrored in the `meta` store. */
export const META_VERSION_KEY = 'schema_version';

/**
 * A single schema migration. `apply` runs inside the native `onupgradeneeded`
 * transaction and may create/delete stores and indexes. It must be synchronous
 * (IndexedDB upgrade transactions cannot await microtasks).
 */
export interface IMigration {
  /** The version this migration upgrades the database *to*. */
  readonly version: number;
  /** Human-readable description for the migration log. */
  readonly description: string;
  /** Applies the structural change. Runs in the upgrade transaction. */
  apply(db: IDBDatabase, transaction: IDBTransaction): void;
}

/**
 * Ordered list of migrations. Migration N is applied when upgrading across
 * version N (i.e. `oldVersion < N <= newVersion`). Never reorder or rewrite a
 * shipped migration — only append.
 */
export const MIGRATIONS: readonly IMigration[] = [
  {
    version: 1,
    description: 'Initial schema: resources, sessions, diagnostics, crawlState, meta',
    apply(db) {
      for (const store of Object.values(STORES)) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath: STORE_KEYPATHS[store] });
        }
      }
    },
  },
];
