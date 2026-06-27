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

> As of Beta-0 Phase 3 the background worker wires `IndexedDbStorageEngine` into
> `CrawlController` (typed as `IStorageEngine`), falling back to `InMemoryStorage`
> only where IndexedDB is unavailable. The composition root requests
> `navigator.storage.persist()` at startup.

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

The `IndexedDbStorageEngine` also implements the **`IControlStateStore`**
contract (`packages/types/src/storage/control-state.ts`), exposing
`saveSession`/`getSession`/`listSessions`/`saveDiagnostics`/`getDiagnostics`/
`saveCrawlState`/`getCrawlState`/`deleteCrawlState`. One class, two interfaces,
one backing database — so a single readwrite IndexedDB transaction can span
resource + control-state writes when atomicity matters.

## Media store (Beta-0 Phase 2)

Binary media (images, later video/audio) is persisted separately from structured
data: **bytes go to OPFS, metadata stays small and queryable.** The contract is
`IMediaStore` (`packages/types/src/storage/media.ts`); it is connector-agnostic
(no platform logic) and implementation-agnostic.

```
IMediaStore  (types — public contract)
    │ put / get / exists / delete / list / statistics / verify / cleanup
    ▼
MediaStore   (storage — layout, metadata sidecars, hashing, crash-consistency)
    │ delegates raw bytes to ↓
    ▼
IMediaBlobBackend  (storage — the only OPFS-aware seam)
    ├── OpfsBlobBackend       (browser: SW / offscreen, extension origin)
    └── InMemoryBlobBackend   (tests / non-OPFS fallback)
```

### Why OPFS, not IndexedDB blobs

IndexedDB blob throughput is poor and serializes through structured-clone +
transaction machinery. OPFS gives file-grade writes for large binaries and keeps
binary bytes out of the structured store. Metadata (small, queryable) stays in
sidecar records; bytes go to OPFS.

### Runtime ownership (important for Phase 3)

OPFS is **origin-scoped**. Only extension-origin contexts (service worker,
offscreen document, popup) can read/write the extension's OPFS. A **content
script runs at the page origin (instagram.com) and cannot** use it. So media
bytes captured in the content script (Beta-1) must be messaged to the service
worker, which owns the `MediaStore`.

### Directory layout (backend-relative)

```
media/
  images/<id>      videos/<id>      audio/<id>      documents/<id>      other/<id>
  meta/<id>.json   metadata sidecar (commit marker)
  tmp/             reserved for future streaming writes
  thumbnails/      cache/   reserved names for later phases (unused)
```

### Crash consistency

A blob is committed by writing its metadata sidecar **after** the bytes (blob
writes are atomic at the backend via OPFS `createWritable`). A blob with no
`complete` sidecar — or a sidecar whose blob is missing — is an orphan that
`cleanup()` removes. Integrity is verifiable via stored `sizeBytes` + SHA-256
`hash` (`verify(id)`).

### Metadata (`IMediaMetadata`)

`id`, `type`, `mimeType`, `sizeBytes`, `hash`, `storagePath`, `state`,
`createdAt`, `lastAccess`, `source?`. Dimensions (width/height/duration) are
deliberately omitted: deriving them requires decoding media, which is an
enrichment concern, not storage.

### Desktop / cloud compatibility

Swap `IMediaBlobBackend` for a Node `fs` backend (desktop) or an object-store
backend (cloud). `IMediaStore` and all consumers are unchanged.

### Limitations

- The in-memory index is rebuilt by reading all sidecars on first access — O(n)
  in blob count. Fine for an Instagram-scale collection; a manifest cache is the
  future optimization if needed.
- `lastAccess` is updated in the runtime cache only (no write-per-read); durable
  persistence arrives with LRU cleanup.
- `OpfsBlobBackend` is exercised via the in-memory backend in unit tests; a real
  browser smoke test is part of Phase 5.
- `navigator.storage.persist()` is requested at startup (Phase 3); if denied,
  OPFS + IndexedDB remain durable across restart but evictable under storage
  pressure. Denial is logged, not fatal.

## Control-state persistence (Beta-0 Phase 3.5)

Crawl **control state** lives in IndexedDB via the `IControlStateStore`
contract — the same database as resources, governed by the same migrations and
quota, eligible for the same multi-store transactions. Resources go to
IndexedDB; control state goes to IndexedDB; media blobs go to OPFS. One
durable-state substrate (IndexedDB + OPFS), not two.

`chrome.storage.local` is no longer used for crawl state. Phase 3 wrote three
legacy keys there; the composition root runs a one-shot migration at startup to
lift any existing values into IndexedDB and clear them. After Beta-0,
`chrome.storage.local` is reserved for future user preferences and feature
flags (configuration, not runtime state).

| IndexedDB store / crawlState key | Contents                                        | Owner             |
| -------------------------------- | ----------------------------------------------- | ----------------- |
| `sessions` + `current_session`   | `ICrawlSession` (status + metrics snapshot)     | `SessionManager`  |
| `crawl_scheduler`                | `ICrawlTask[]` (full queue with retry state)    | `CrawlController` |
| `crawl_diagnostics`              | `IDiagnosticsState` (failures + strategy usage) | `CrawlController` |
| `diagnostics`                    | `ISessionReport` per completed session          | reserved          |
