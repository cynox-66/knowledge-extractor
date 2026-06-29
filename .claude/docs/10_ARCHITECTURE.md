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
- **`Navigator` (Content):** Sole owner of browser manipulation (scrolling, clicking). Surface-aware: it consumes the connector's `SurfaceDescriptor` to decide in-place vs modal open and which element to scroll.
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
Persistence (Background: IndexedDB) — resource saved as EXTRACTED; task COMPLETE
   ↓
Media Capture (Content/Background: best-effort, non-fatal) — upgrades to HYDRATED
   ↓
[Future] OCR / Enrichment
```

### P0 Stabilization invariants (Alpha Validation)

These were introduced when the pipeline was first validated against live Instagram. They constrain the orchestration layer only; the layered architecture is unchanged.

- **Pinned tab (RCA-8):** A crawl pins exactly one Instagram tab at `startCrawl` (persisted as `ICrawlSession.tabId`) and drives every message — navigate, extract, scroll, capture — to that id. The running loop never queries the "active tab"; if the pinned tab is closed the crawl finishes (`tab-closed`). `startCrawl` refuses to begin without a focused Instagram tab.
- **Discovery readiness barrier (RCA-3):** The loop may not scroll or declare end-of-feed until `DISCOVERY_SETTLE_MS` has elapsed since the last discovery opportunity (crawl start, resume, or a completed scroll). End-of-feed requires `MAX_EMPTY_SCROLLS` *consecutive* unproductive scrolls — no single no-growth scroll can terminate a crawl.
- **Knowledge-first persistence (RCA-6):** A normalized resource is persisted (state `EXTRACTED`) *before* media capture and is never rolled back. Media hydration is a separate best-effort stage that upgrades the record to `HYDRATED`; its failure is recorded to diagnostics but never discards extracted knowledge nor fails the crawl task.

### P1 invariants — Surface-aware navigation

The connector owns a **Surface** abstraction (`detectSurface(url)` → `SurfaceDescriptor`) capturing per-route Instagram interaction knowledge. The generic content-script `Navigator` consumes it; it holds no surface knowledge of its own.

- **Open mode per surface (RCA-1/2):** `home-feed` posts are extracted **in place** — the Navigator never clicks a feed permalink (a real SPA navigation that previously carried the crawl into the author's profile). `grid` surfaces (saved / profile / explore) open a **modal**, detected by a robust multi-candidate matcher (`findOpenPostModal`) instead of one frozen selector, and closing is confirmed before the crawl continues.
- **Pinned surface:** the crawl surface is captured once at pipeline start (on the base feed/grid URL) and reused for all navigation/scroll decisions, so a transient modal permalink in the address bar never reclassifies the surface mid-crawl.
- **Discovery route guard (RCA-2/5):** the `DiscoveryEngine` is pinned to the start surface. It never harvests links inside an open post modal, and it stops scanning entirely once the page has genuinely navigated off-surface — eliminating the "more posts from this author" wandering.
- **Surface scroll container (RCA-4):** scrolling targets the surface's real scroll container (probed via candidate selectors), falling back to the window only when none scrolls.

### P2 invariants — Completeness & robustness

- **Carousel traversal (RCA-7):** extraction is no longer a single DOM snapshot. After the first slide, the content script walks the carousel — `Navigator.advanceCarousel(scope)` clicks the connector-located Next control (`findCarouselNext`), scoped to the post so it never advances a neighbouring feed post — re-extracting and unioning each slide's media until the Next control disappears (last slide) or a hard `MAX_CAROUSEL_SLIDES` bound. The resource then carries every slide's media as carousel children.
- **Incremental, surface-specific discovery (RCA-5/9, RFC-0001 A4):** the `MutationObserver` scans only newly-added subtrees (including the added node itself), not the whole document — cost is linear in *new* DOM, not quadratic in collection size. `scanDOM` selects the grid-link sweep or the article sweep by surface kind.
- **Fail-fast retries (RCA-9):** failures that a re-open cannot fix — the thumbnail/article is simply not in the DOM — are failed permanently via `Scheduler.failPermanently`, skipping the backoff/modal-timeout budget. Transient causes (modal timeout, storage) stay on the retry path.

## Media Pipeline
Media fetches (e.g., Instagram CDN) require authenticated session cookies, so fetches originate from the content script.
- Normalization creates `IMedia` records with a `sourceUri`.
- `MediaCaptureCoordinator` messages the **pinned crawl tab** (id threaded in by the controller) to fetch bytes; it runs *after* the resource is already persisted.
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
