# Architecture

This document is the authoritative reference for the Knowledge Extractor system
architecture. It is derived from the implementation, not from plans. Every
interface, file path, and message name listed here exists in the codebase.

## Layered package structure

Dependency direction is strictly enforced by
[dependency-cruiser](/.dependency-cruiser.js) in CI.

```
Layer 0: packages/types        (interfaces only — imports nothing)
    ↑
Layer 1: packages/shared       (logging, metrics, diagnostics, feature flags)
    ↑
Layer 2: packages/storage      (IStorageEngine, InMemoryStorage)
    ↑
Layer 3: connectors/instagram  (discover, extract, normalize)
    ↑
Layer 4: apps/extension        (background, content, popup)
```

A package at Layer N may import from Layer < N only. Connectors may not import
other connectors. No package may import from `apps/`.

## Domain model

The system is built around a single normalized aggregate root, `IResource`
(`packages/types/src/core/resource.ts`). Platform-specific concepts (Instagram
posts, Reddit threads, etc.) never appear as first-class domain types.

```
IResource
  ├── id: string                 (deterministic, e.g. ig_<externalId>)
  ├── kind: string               (e.g. 'instagram-post', 'instagram-reel')
  ├── state: ResourceState       (discovered → extracted → hydrated → enriched → persisted → exported)
  ├── source: ISource            (provenance: providerName, externalId, originalUri, extractedAt)
  ├── author?: IAuthor           (handle, displayName, avatarUri)
  ├── content: IContentBlock[]   (TEXT, HEADING, QUOTE, CODE, TRANSCRIPT)
  ├── media: IMedia[]            (IMAGE, VIDEO, AUDIO — sourceUri, localUri)
  ├── children?: IResource[]     (e.g. carousel slides)
  └── completeness: IResourceCompleteness (thumbnail, metadata, media, ocr)
```

Execution state (`ICrawlTask`, `TaskState`) and domain state
(`IResourceCompleteness`) are strictly separated: the Scheduler owns execution,
the resource owns completeness.

## Component responsibilities

### CrawlController (`apps/extension/src/background/crawl-controller.ts`)

Sole orchestrator. Owns the processing loop, drives all pipeline stages, and
persists state after every transition. MV3-safe: uses a self-scheduling
`setTimeout` chain with a `chrome.alarms` watchdog (`ke-crawl-tick`, 1-min
period). Resumes from persisted state on worker restart.

### Scheduler (`apps/extension/src/background/scheduler.ts`)

Owns the `Map<string, ICrawlTask>` queue. Handles enqueue (with dedup),
priority, task state transitions, and exponential-backoff retry
(`baseBackoffMs * 2^(attempts-1)`, via `nextRetryAt`). `snapshot()` / `restore()`
persist the full queue to `chrome.storage.local` (durable across browser
restart); on restore, in-flight tasks reset to `QUEUED`.

### Navigator (`apps/extension/src/content/navigator.ts`)

Owns all browser manipulation: scroll, open modal, close modal, wait for DOM
stabilization. Lives in the content script. No extraction logic.

### Content Script (`apps/extension/src/content/index.ts`)

Pure DOM adapter. Locates `<article>` elements and delegates parsing to the
connector via `connector.extract()`. Captures a trimmed DOM snapshot on failure.
Runs the `DiscoveryEngine` (MutationObserver-based) for resource discovery.

### InstagramConnector (`connectors/instagram/src/index.ts`)

Implements `IConnector<IInstagramParsedPost>`. Two entry points:

- `extract(article)` — runs the StrategyChain and returns a raw `IInstagramParsedPost` tagged with the winning strategy name.
- `normalize(post)` — maps raw to `IResource` via `InstagramNormalizer`.

### StrategyChain (`connectors/instagram/src/strategy-chain.ts`)

Executes an ordered list of `IExtractionStrategy` implementations. Returns the
first applicable result tagged with `{ data, strategyName }`. Current chain:

1. `SemanticArticleStrategy` (ARIA roles, `href` patterns — highest confidence)
2. `DataAttributeStrategy` (class-name fragments — medium)
3. `StructuralHeuristicStrategy` (any block with images — lowest)

### SessionManager (`apps/extension/src/background/session-manager.ts`)

Single source of truth for crawl state. Persists `ICrawlSession` to
`chrome.storage.local` (durable across browser restart). Embeds a
`MetricsCollector` snapshot on every persist so counters are never duplicated.
Rehydrates metrics on worker restart.

### MetricsCollector (`packages/shared/src/metrics-collector.ts`)

Canonical runtime metrics source. Accumulates stage counters, failure counters,
timing totals, and derived averages. Produces `IExtractionMetrics` snapshots.
Supports `hydrate()` for restoring state after restart.

### DiagnosticsCollector (`packages/shared/src/diagnostics-collector.ts`)

Records per-failure data (category, target URI, message, DOM snapshot, failing
strategy) and per-extraction strategy usage. Produces `ISessionReport` via
`buildReport(metrics)`. `snapshot()`/`hydrate()` let the background worker
persist diagnostics to `chrome.storage.local` (durable across restart) without
coupling `shared` to chrome APIs.

### Storage (`packages/storage`)

The runtime uses `IndexedDbStorageEngine` (durable resources) by default,
degrading to `InMemoryStorage` only where IndexedDB is unavailable. Both
implement the frozen `IStorageEngine`; `CrawlController` depends on the
interface, never the concrete class. See [STORAGE.md](STORAGE.md).

### MediaStore (`packages/storage/src/media`)

Durable binary media persistence (`IMediaStore`), owned by the composition root
and injected into `CrawlController`. **Not consumed in Beta-0** — exposed via
`CrawlController.getMediaStore()` for the Beta-1 media-capture / OCR pipeline.

### Popup (`apps/extension/src/popup/index.tsx`)

Stateless monitoring dashboard. Hydrates from `GET_SESSION` on open. Renders
metrics from the canonical `ICrawlSession.metrics` snapshot. Controls:
Start / Pause / Resume / Cancel / Export Diagnostics. Closing the popup never
stops the crawl.

## Runtime composition & lifecycle

### Composition root

`apps/extension/src/background/index.ts` is the **only** place that constructs
infrastructure. It builds `MetricsCollector`, `DiagnosticsCollector`,
`InstagramConnector`, the `IStorageEngine` (`IndexedDbStorageEngine`, or
`InMemoryStorage` if IndexedDB is unavailable), and the `IMediaStore`
(`OpfsBlobBackend`, or `InMemoryBlobBackend` if OPFS is unavailable), then
injects them into `CrawlController`. Subsystems never construct infrastructure
themselves.

### Startup lifecycle

```
SW starts → index.ts (sync):
  1. construct infrastructure (lazy: no I/O yet)
  2. construct CrawlController(metrics, diagnostics, connector, storage, mediaStore)
  3. register chrome.alarms + chrome.runtime listeners  ← synchronous, before any await
  4. kick off async startup():
       requestPersistence()           navigator.storage.persist() (best-effort)
       probe storage                  surface a diagnostic if durable storage is broken
       controller.init()              recover session + queue + diagnostics, resume if active
```

Listeners are registered synchronously (before the first `await`) so a revived
worker never misses an event.

### Persistence lifecycle

| Data                       | Store                        | Survives SW eviction | Survives browser restart |
| -------------------------- | ---------------------------- | -------------------- | ------------------------ |
| Resources (`IResource`)    | IndexedDB (`IStorageEngine`) | ✅                   | ✅                       |
| Media blobs                | OPFS (`IMediaStore`)         | ✅                   | ✅                       |
| Session + embedded metrics | `chrome.storage.local`       | ✅                   | ✅                       |
| Scheduler queue            | `chrome.storage.local`       | ✅                   | ✅                       |
| Diagnostics snapshot       | `chrome.storage.local`       | ✅                   | ✅                       |

> Control state (session/queue/diagnostics) uses `chrome.storage.local` rather
> than the IndexedDB auxiliary stores: it is small, frequently written, and this
> avoids coupling the control subsystems to the concrete engine. The IndexedDB
> `sessions`/`diagnostics`/`crawlState` stores remain available for future
> session-history / export features.

### Recovery lifecycle

On every worker startup `CrawlController.init()` reconnects to the durable
stores and restores state: `SessionManager.init()` (session + metric rehydrate),
`hydrateScheduler()` (queue; in-flight tasks reset to `QUEUED`),
`hydrateDiagnostics()`. If the persisted session was `isRunning && !isPaused`,
the crawl resumes automatically. The IndexedDB connection and `MediaStore`
reattach lazily on first use.

**Persistence is the success gate.** In `processNext`, a resource is persisted
(`saveResource` → `commit`) **before** `scheduler.markCompleted`. A persistence
failure throws, is caught, and routes to `handleTaskFailure` — the task is left
non-completed and retried, and a diagnostic is recorded. Combined with
deterministic resource ids (`ig_<externalId>`) and idempotent `saveResource`,
this guarantees no duplicate resources and no work marked complete without
durable persistence.

## Message flow

```
Popup                    Background (SW)           Content Script
  │ START_PIPELINE ──────→│                              │
  │                       │ startCrawl()                 │
  │                       │──── RUN_PIPELINE ───────────→│ DiscoveryEngine.start()
  │                       │                              │
  │                       │←── RESOURCES_DISCOVERED ─────│ (batch of discovered URIs)
  │                       │ handleDiscoveryBatch()       │
  │                       │    Scheduler.enqueue()       │
  │                       │                              │
  │                       │ tick() → processNext()       │
  │                       │──── NAVIGATE_OPEN ──────────→│ Navigator.openResource()
  │                       │←── response ─────────────────│
  │                       │──── EXTRACT_RESOURCE ───────→│ connector.extract()
  │                       │←── { data, strategyName } ──│
  │                       │──── NAVIGATE_CLOSE ─────────→│ Navigator.closeResource()
  │                       │                              │
  │                       │ connector.normalize()        │
  │                       │ storage.saveResource()       │
  │                       │ metrics + diagnostics        │
  │                       │                              │
  │←── SESSION_UPDATED ──│ (persisted session snapshot)  │
  │←── SYSTEM_STATUS ────│ (event stream for UI)         │
```

## Dependency enforcement

`dependency-cruiser` rules (`.dependency-cruiser.js`):

| Rule                                  | Effect                                               |
| ------------------------------------- | ---------------------------------------------------- |
| `no-circular`                         | No circular dependencies anywhere                    |
| `connectors-cannot-import-connectors` | Connector A cannot import Connector B                |
| `no-app-dependencies`                 | No package/connector may import from `apps/`         |
| `primitives-no-imports`               | `packages/types` imports nothing from the monorepo   |
| `core-utilities-isolation`            | `packages/shared` imports only from `packages/types` |

## Frozen decisions

These require an RFC to change (see [RFC-0001](../rfc/RFC-0001.md)):

- Normalized domain model (`IResource` and its value objects)
- Execution vs. domain state separation (`ICrawlTask` vs. `IResourceCompleteness`)
- Package boundaries and dependency direction
- Connector isolation (connectors own discover/extract/normalize only)
- CrawlController as sole orchestrator
- Scheduler as sole queue/retry owner
- Navigator as sole browser-manipulation owner
- Storage abstraction (`IStorageEngine`/`ITransaction`)
- Popup as monitoring-only (no execution)
