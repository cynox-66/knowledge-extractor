# Architecture Reference

## Layer Diagram & Dependency Rules

Strict hierarchical dependencies enforced by `dependency-cruiser`. No circular or upward imports.

```text
Layer 4: apps/extension (MV3 Runtime, Orchestration)
   ↓
Layer 3: connectors/* (Source-specific extraction)
   ↓
Layer 2: packages/storage (IndexedDB, OPFS)
   ↓
Layer 1: packages/shared (Metrics, Diagnostics)
   ↓
Layer 0: packages/types (Domain Contracts, IResource)
```

## Package Responsibilities
- **`types`**: Single source of truth for the normalized domain (`IResource`).
- **`shared`**: Tooling for logging, metrics, and failure diagnostics.
- **`storage`**: Implementation of IndexedDB (control state & resources) and OPFS (media blobs).
- **`connector-*`**: Discover, extract, and normalize. Agnostic to orchestration.
- **`apps/extension`**: Orchestrator. Manages Chrome lifecycle, alarms, messages, and UI.

## Runtime Ownership
- **`CrawlController` (Background):** Sole orchestrator. Manages the loop.
- **`Scheduler` (Background):** Sole owner of queue, priority, and retry logic.
- **`Navigator` (Content):** Sole owner of browser manipulation (scrolling, clicking).
- **`Popup`:** Strictly stateless monitoring dashboard.

## Crawl Pipeline

```text
Discovery (Content Script: MutationObserver)
   ↓ (RESOURCES_DISCOVERED)
Scheduler (Background: Deduplicate & Queue)
   ↓ (Tick)
Navigator (Content Script: Scroll/Modal)
   ↓
Extract (Content Script: StrategyChain)
   ↓
Normalize (Background: Map to IResource)
   ↓
Media Capture (Content/Background: Fetch authenticated bytes)
   ↓
Persistence (Background: IndexedDB + OPFS)
   ↓
[Future] OCR / Enrichment
```

## Media Pipeline
Media fetches (e.g., Instagram CDN) require authenticated session cookies, so fetches originate from the content script.
- Normalization creates `IMedia` records with a `sourceUri`.
- `MediaCaptureCoordinator` messages the active tab to fetch bytes.
- Content script returns `ArrayBuffer`s.
- Background saves bytes to `IMediaStore` (OPFS) and updates resource to `HYDRATED`.

## Storage Architecture
Unified under `IndexedDbStorageEngine` which implements `IStorageEngine` (resources) and `IControlStateStore` (session state, queue). Uses `BufferedTransaction` for cross-store atomicity. Media blobs use OPFS via `MediaStore`.

## MV3 Lifecycle & Thread Ownership
- **Background Worker:** Orchestration, scheduling, normalization, persistence, metrics.
- **Content Script:** DOM observation, DOM manipulation, DOM parsing, authenticated fetches.
- **Survival Mechanics:** Processing loop is a self-scheduling `setTimeout` chain, backed by a 1-minute `chrome.alarms` watchdog. Queue and session persist to IndexedDB on every state transition. Suspended workers resume exactly where they left off.

## Frozen Architectural Constraints
- **Normalized Domain Model:** `IResource` is the single aggregate root.
- **Execution vs. Domain State:** Separation between execution (`ICrawlTask`) and domain (`IResourceCompleteness`).
- **Connector Isolation:** Connectors never store data or orchestrate crawls.
