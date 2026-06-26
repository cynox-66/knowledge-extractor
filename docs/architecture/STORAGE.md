# Storage

## Abstraction

Storage is accessed through `IStorageEngine` and `ITransaction`
(`packages/types/src/storage/storage.ts`):

```typescript
interface IStorageEngine {
  beginTransaction(): Promise<ITransaction>;
  saveResource(resource: IResource, transaction?: ITransaction): Promise<void>;
  getResourceById(id: string): Promise<IResource | null>;
  deleteResource(id: string, transaction?: ITransaction): Promise<void>;
}

interface ITransaction {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}
```

## Implementations

| Class                    | File                                                  | Durability                                   | Use             |
| ------------------------ | ----------------------------------------------------- | -------------------------------------------- | --------------- |
| `InMemoryStorage`        | `packages/storage/src/memory-storage.ts`              | Volatile (lost on unload)                    | Tests, fallback |
| `IndexedDbStorageEngine` | `packages/storage/src/indexeddb/indexeddb-storage.ts` | Durable across SW eviction + browser restart | Beta default    |

> Beta-0 Phase 3 swaps the `CrawlController` wiring from `InMemoryStorage` to
> `IndexedDbStorageEngine`. As of Phase 1 the durable engine exists and is fully
> tested but is not yet wired into the background worker.

## IndexedDB engine (Beta-0)

A single database `knowledge-extractor` with versioned, migration-driven schema.

**Object stores:**

| Store         | Key         | Contents                                               |
| ------------- | ----------- | ------------------------------------------------------ |
| `resources`   | `id`        | Normalized `IResource` (the `IStorageEngine` contract) |
| `sessions`    | `sessionId` | `ICrawlSession` (status + metrics)                     |
| `diagnostics` | `sessionId` | `ISessionReport`                                       |
| `crawlState`  | `key`       | Generic runtime state (e.g. scheduler queue snapshot)  |
| `meta`        | `key`       | Schema version + migration metadata                    |

**Schema versioning & migrations** (`src/indexeddb/schema.ts`): an ordered
`MIGRATIONS` list applied in `onupgradeneeded`. Migrations are append-only and
run for every version in `oldVersion < v <= newVersion`. The active version is
mirrored into the `meta` store for observability.

**Transactions** (`src/indexeddb/transaction.ts`): `beginTransaction()` returns a
`BufferedTransaction` — a unit-of-work that buffers operations in memory and
flushes them inside **one native readwrite transaction** at `commit()`. This is
required because native IndexedDB transactions auto-close across `await`s, while
callers (`CrawlController`) hold a transaction across ticks. `commit()` is atomic
(the native transaction aborts on any error); `rollback()` discards the buffer.

The `IndexedDbStorageEngine` also exposes typed auxiliary accessors
(`saveSession`/`getSession`/`saveDiagnostics`/`getDiagnostics`/`saveCrawlState`/…)
for the non-resource stores. These are additive to the concrete class and do not
change the frozen `IStorageEngine` interface; they are wired into `SessionManager`
and `CrawlController` in Phase 3.

## Session/queue persistence (Alpha — pre-Phase-3)

Until Phase 3 wires the durable engine in, crawl session state and the Scheduler
queue persist to `chrome.storage.session` (survives SW eviction but **not** a
browser restart):

| Key               | Contents                                     | Owner             |
| ----------------- | -------------------------------------------- | ----------------- |
| `crawl_session`   | `ICrawlSession` (status + metrics snapshot)  | `SessionManager`  |
| `crawl_scheduler` | `ICrawlTask[]` (full queue with retry state) | `CrawlController` |
