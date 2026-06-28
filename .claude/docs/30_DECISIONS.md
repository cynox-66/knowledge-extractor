# Engineering Decisions (ADR)

## ADR-001: IndexedDB for Durable Storage
- **Status:** Active
- **Decision:** Use IndexedDB as the primary durable storage substrate (`IndexedDbStorageEngine`).
- **Context:** Service workers in MV3 are ephemeral and memory is frequently evicted. We need structured, durable storage for both the `IResource` domain models and the operational control state (`ICrawlSession`, `ICrawlTask`).
- **Alternatives Considered:** `chrome.storage.local` (quota limitations, poor query performance), `InMemoryStorage` (data loss on eviction).
- **Tradeoffs:** IndexedDB API is clunky and requires wrapper abstractions. Browser storage can still be evicted if `navigator.storage.persist()` is not granted.
- **Consequences:** Safe survival of MV3 lifecycle events. Requires unified transaction handling.

## ADR-002: OPFS (Origin Private File System) for Media
- **Status:** Active
- **Decision:** Use OPFS as the backing store for media bytes (`MediaStore`).
- **Context:** Blobs and binary data are inefficient in IndexedDB. Passing large images directly to local OCR engines requires high-performance, file-system-like access to avoid crashing worker memory.
- **Alternatives Considered:** Storing Base64 strings or Blob records directly in IndexedDB.
- **Tradeoffs:** OPFS is a newer web API, requiring an `InMemoryBlobBackend` fallback for environments where it is unsupported.
- **Consequences:** Efficient binary storage, separated from structured metadata.

## ADR-003: MediaStore Abstraction
- **Status:** Active
- **Decision:** Isolate file-system mechanics into an `IMediaStore` contract.
- **Context:** Orchestration logic (`MediaCaptureCoordinator`) needs to save files without knowing the underlying storage constraints of the environment.
- **Alternatives Considered:** Direct OPFS API calls inside the coordinator.
- **Tradeoffs:** Adds an extra layer of indirection.
- **Consequences:** Allows graceful fallbacks to in-memory blobs during testing or in unsupported browsers.

## ADR-004: CrawlController Orchestration Ownership
- **Status:** Active
- **Decision:** The `CrawlController` is the supreme and sole orchestrator of the pipeline.
- **Context:** MV3 lifecycle management (alarms, suspension, recovery) is complex. Distributing orchestration across multiple classes leads to race conditions and lost work.
- **Alternatives Considered:** Decentralized event-driven architecture where modules trigger each other.
- **Tradeoffs:** Creates a single large controller class.
- **Consequences:** Centralizes the `tick()` loop, making pause, resume, and watchdog recovery reliable.

## ADR-005: Scheduler Retry Ownership
- **Status:** Active
- **Decision:** The `Scheduler` independently manages the queue, priority, and exponential backoff.
- **Context:** We need a robust retry policy for network and parsing failures without cluttering the main loop.
- **Alternatives Considered:** Putting retry logic directly in the connector or the CrawlController.
- **Tradeoffs:** Requires synchronizing queue state with durable storage on every tick.
- **Consequences:** Keeps backoff logic separate from execution. The queue serializes neatly to IndexedDB as plain data.

## ADR-006: Layered Architecture
- **Status:** Active
- **Decision:** Enforce strict hierarchical dependencies using `dependency-cruiser`.
- **Context:** Preventing platform-specific logic (e.g., Instagram DOM shapes) from polluting core domain contracts is vital for long-term scalability.
- **Alternatives Considered:** Flat module structure, feature-based slices without strict layer boundaries.
- **Tradeoffs:** Requires boilerplate and careful module exports.
- **Consequences:** Guarantees the extraction engine remains completely source-agnostic.

## ADR-007: Connector Isolation
- **Status:** Active
- **Decision:** Connectors only discover, extract, and normalize. They never store data or orchestrate.
- **Context:** Adding new sources (Reddit, LinkedIn, YouTube, PDFs) should not risk breaking the core engine.
- **Alternatives Considered:** Allowing connectors to manage their own persistence to accommodate source-specific quirks.
- **Tradeoffs:** Forces all connectors to conform strictly to the `IResource` output.
- **Consequences:** Infinite horizontal scalability for new sources by implementing the `IConnector` interface.

## ADR-008: Buffered Transactions
- **Status:** Active
- **Decision:** Storage engines must provide an `ITransaction` that buffers writes until commit.
- **Context:** We must ensure atomicity across resources and control state. If a resource is persisted, its task must be marked `COMPLETED` in the same transaction.
- **Alternatives Considered:** Auto-committing individual writes.
- **Tradeoffs:** Increased memory usage during the transaction buffer phase.
- **Consequences:** If the worker dies mid-tick, the entire transaction is rolled back, preventing orphaned data or stuck tasks.

## ADR-009: Offscreen Document for MV3-Safe Tesseract.js OCR Execution
- **Status:** Active
- **Decision:** Run Tesseract.js v7 OCR inside a `chrome.offscreen` document (reason: `WORKERS`) rather than directly in the MV3 background service worker.
- **Context:** Phase 4A (OCR Engine) requires Tesseract.js to execute in the background context. Pre-implementation verification revealed two independent, spec-level blockers preventing direct service-worker execution.
- **Problem:** Two irresolvable constraints exist simultaneously:
  1. The Service Worker specification forbids nested worker creation. Chrome MV3 background contexts are service workers. `new Worker()` called from a service worker is blocked at the spec level — not a Chrome bug, not fixable via configuration. Tracked in crbug.com/1219164.
  2. Tesseract.js v7 exclusively uses an internal Web Worker in browser contexts. `createWorker()` is the only entry point; there is no synchronous, no-worker, or single-threaded execution mode.
  Together: Tesseract.js requires a Web Worker; service workers cannot spawn Web Workers. No configuration resolves both constraints simultaneously.
- **Why direct service-worker OCR was rejected:** Even if a hypothetical synchronous Tesseract mode existed, blocking the service worker event loop with multi-second WASM computation would starve Chrome event handling and trigger MV3 termination — the same failure mode guarded against in the crawl loop. The rejection holds on both technical and architectural grounds.
- **Why `chrome.offscreen` was selected:**
  - Chrome designed the `chrome.offscreen` API for exactly this scenario. The `WORKERS` reason code is explicitly defined as "the offscreen document needs to spawn workers."
  - Offscreen documents are full DOM contexts with no automatic lifecycle timeout (only `AUDIO_PLAYBACK` carries a 30-second limit).
  - The `src/offscreen/` directory was pre-provisioned in the extension scaffold, indicating this use was anticipated.
  - All WASM compilation, Tesseract worker initialization, and blob-to-text processing happen inside the offscreen document. The service worker only dispatches image data via `chrome.runtime.sendMessage` and receives `IContentBlock[]` results.
  - No changes to `IOcrEngine`, `EnrichmentLoop`, or any storage contract are required.
- **Why `IOcrEngine` remains unchanged:** `IOcrEngine` is a Layer 0 contract (`packages/types`). The offscreen dispatch mechanism is an implementation detail of `OcrEngine` in Layer 4 (`apps/extension`). Exposing offscreen routing at the interface level would leak infrastructure concerns into the domain contract and violate the layered architecture (ADR-006).
- **Why `EnrichmentLoop` remains unchanged:** `EnrichmentLoop` is built around the `onWorkItem` injection point as the correct seam for strategy substitution. The offscreen document lifecycle (`createDocument`, `closeDocument`) is entirely internal to `OcrEngine.process()`. Modifying the loop for OCR-specific infrastructure would violate separation of concerns (ADR-004).
- **Alternatives Considered:**
  - *Direct service-worker execution:* Blocked at spec level; rejected (see above).
  - *Extension popup/window hosting workers:* Requires visible UI; unacceptable UX for a background pipeline.
  - *Content script Web Worker:* Tied to a specific tab; incompatible with background pipeline ownership (ADR-004).
  - *Cloud OCR API:* Violates the local-first constraint absolutely.
  - *Scribe.js:* AGPL 3.0 license; disqualified for a distributed product.
- **Tradeoffs:**
  - (+) Chrome-canonical solution; no hacks or workarounds.
  - (+) Full DOM context in the offscreen document; Tesseract Web Worker runs normally.
  - (+) All existing interfaces, the storage layer, and `EnrichmentLoop` remain unchanged.
  - (-) One `chrome.runtime.sendMessage` round-trip per image; adds per-call latency.
  - (-) Chrome enforces a single offscreen document per extension profile at a time. A future feature requiring its own offscreen document will need coordination or a shared-router pattern.
  - (-) `OcrEngine` must manage offscreen document lifecycle (open/close), adding complexity absent from a direct library call.
  - (-) `ArrayBuffer` is transferred via structured clone (efficient, not zero-copy); negligible overhead for typical social-media image sizes.
- **Future Migration Considerations:**
  - If Chrome lifts the nested-worker restriction, the offscreen layer can be removed entirely and `OcrEngine` can call Tesseract directly — `IOcrEngine` and `EnrichmentLoop` require no changes.
  - If a second extension feature requires an offscreen document, introduce a shared document with a multiplexing message router at that point.
  - If `tesseract-wasm` (robertknight) matures, it can replace Tesseract.js behind `IOcrEngine.extractText()` without architectural change.
- **References:**
  - chrome.offscreen API reference: https://developer.chrome.com/docs/extensions/reference/api/offscreen
  - Offscreen Documents in MV3 — Chrome Blog: https://developer.chrome.com/blog/Offscreen-Documents-in-Manifest-v3
  - MV3 nested worker prohibition — Chromium Extensions Group: https://groups.google.com/a/chromium.org/g/chromium-extensions/c/g4C4QU8JgNo
  - crbug.com/1219164 — nested workers blocked in service workers
  - Tesseract.js v7.0.0 release notes: https://github.com/naptha/tesseract.js/releases
  - Tesseract.js MV3 issues #601 and #961: https://github.com/naptha/tesseract.js/issues/961
