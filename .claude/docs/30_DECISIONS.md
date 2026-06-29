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

## ADR-010: Knowledge/Media Layer Boundary ("Knowledge is permanent, Media is policy-managed")
- **Status:** Active (Beta-3)
- **Decision:** Formalize the existing IndexedDB/OPFS split as a governed architectural boundary. The **Knowledge Layer** (`IResource` in IndexedDB: content blocks, OCR transcripts, captions, source URIs, provenance) is **permanent** and self-sufficient for export and future search without the media layer present. The **Media Layer** (raw bytes in OPFS via `IMediaStore`) is **policy-managed**. A full-resolution media blob is eligible for cache eviction **only** when its parent resource is `ENRICHED` or `EXPORTED` **and** not user-pinned (the *eviction invariant*).
- **Context:** Beta-2 stores all media bytes durably. At hundreds of thousands of resources this is hundreds of GB to several TB — impractical. Engineering review proposed "knowledge is permanent, media is a cache."
- **Why "cache" was rejected in favor of "policy-managed":** "Cache" implies re-fetchability. Platform media is frequently **not** re-fetchable — Instagram CDN URLs are signed and expire, posts and accounts get deleted. A store you cannot repopulate is not a cache. Additionally, the knowledge inside media is only permanent *after* extraction (OCR), so `HYDRATED`-but-not-`ENRICHED` bytes must be retained. The eviction invariant encodes both facts.
- **Alternatives Considered:** (a) Keep all media permanently — rejected (unbounded TB growth). (b) Never store media — rejected (breaks offline OCR re-runs, destroys visual context, and bytes are often gone by re-export time). (c) Accept the naive "media is a cache" slogan — rejected (implies false re-fetchability; risks permanent loss).
- **Tradeoffs:** (+) Bounded storage; knowledge never lost on eviction; reuses `IMediaStore` unchanged. (−) Requires a retention policy + janitor (ADR-014); export must tolerate absent bytes (handled by `MediaInclusion` fallback to remote links).
- **Consequences:** The knowledge layer is the canonical, permanent asset and the basis for all export and future AI indexing. The media layer becomes a managed, evictable tier. See `docs/architecture/EXPORT_ARCHITECTURE.md` §8, §10.

## ADR-011: `IExportItem` Projection as the Canonical Export Model
- **Status:** Active (Beta-3)
- **Decision:** Exports do **not** operate on `IResource` directly. Introduce exactly one intermediate abstraction, `IExportItem` — a pure, format-agnostic projection of a single resource (frontmatter + structured body + resolved media manifest), produced by a pure `ResourceProjector` in `packages/export` (Layer 2). Serializers consume `IExportItem`, never `IResource`. Bytes never flow through serializers: binary `IExportPart`s carry only a `mediaId`, resolved by the Layer-4 coordinator at write time.
- **Context:** Beta-3 needs JSON, Markdown, and Obsidian exports of resources that may contain present or evicted media, at 100k+ scale, inside MV3 memory limits.
- **Why a projection (not raw `IResource`):** (1) Media relative-path assignment must happen **once** so the markdown link and the file actually written never diverge. (2) Serializers become pure functions, unit-testable from fixtures with no storage/runtime. (3) The on-disk export schema is decoupled from the internal `IResource`, so user files never leak internal fields (`state`, `completeness`) and never churn when the domain evolves. (4) It is the natural reuse seam for future embedding/AI consumers.
- **Alternatives Considered:** (a) Serialize `IResource` directly (the deprecated `IExporter.export(resource): Promise<string>` stub) — rejected: a `string` cannot express a multi-file Obsidian vault, `exportBatch(resources[])` forces all resources into memory, and each format would re-resolve media independently (link drift). (b) Multiple intermediate models — rejected as over-engineering; one suffices.
- **Tradeoffs:** (+) One shared media-resolution site; pure testable serializers; stable export schema; AI seam. (−) One extra type and a projection step.
- **Consequences:** The speculative `IExporter`/`ExportFormat` stub (`packages/types/src/export/exporter.ts`) is removed in M1 and replaced by the contracts in `EXPORT_ARCHITECTURE.md` §5.

## ADR-012: `packages/export` as an Isolated Layer-2 Package; Coordinator at Layer 4; No Speculative Seams
- **Status:** Active (Beta-3)
- **Decision:** Place pure serialization logic in a new Layer-2 package `packages/export`, sibling to `packages/storage` and mutually isolated from it via a new `dependency-cruiser` rule (`export-and-storage-isolated`). All infrastructure-touching orchestration (`ExportCoordinator`, `ExportWriter`, serializer registry, `MediaJanitor`) lives at Layer 4 in `apps/extension/src/background/`. **Deliberately do not introduce** an `IExportSink` interface or an `IMediaResolver` interface in Beta-3.
- **Context:** Export transformation is pure and source-agnostic (belongs low in the hierarchy); paging storage, reading media bytes, assembling ZIPs, and MV3 ticks are infrastructure (belong at Layer 4, like `CrawlController`).
- **Why no sink/resolver interfaces (over-engineering audit):** Beta-3 has exactly one writer (ZIP/single-file → `chrome.downloads`) and one media-resolution path (read `IMediaStore`). An interface with a single implementation is a speculative abstraction. The writer is a concrete `ExportWriter` class; the coordinator reads `IMediaStore` directly; media inclusion is a request flag (`MediaInclusion`), not a strategy object. The interfaces would exist only for hypothetical cloud-sync / download-on-demand futures — extract them *if and when* those ship (cheap refactor).
- **Alternatives Considered:** (a) Export logic as a folder inside `apps/` — rejected: loses enforced purity and isolated unit-testing. (b) Keep `IExportSink`/`IMediaResolver` interfaces — rejected per the audit above. (c) A generic `IJob`-based export queue — rejected: the existing self-scheduling-tick pattern is sufficient (Rule 12).
- **Tradeoffs:** (+) Enforced purity; pure unit tests; minimal abstraction surface for a small team. (−) A new workspace package; a future sink/resolver extraction is a (small) later refactor.
- **Consequences:** `packages/export` imports only Layer 0/1. Coordinator/writer/janitor sit beside existing background infrastructure. See `EXPORT_ARCHITECTURE.md` §3, §4.

## ADR-013: Export is Non-Destructive; Single `ExportTarget` Enum; Static Serializer Lookup (No Plugin Framework)
- **Status:** Active (Beta-3)
- **Decision:** (1) Export is a read-only projection — it does **not** advance `ResourceState` by default; it is idempotent and repeatable. `ResourceState.EXPORTED` remains an optional, coarse "has ever been exported" UX flag only. (2) Use a single user-facing `ExportTarget` enum (`JSON`, `MARKDOWN`, `OBSIDIAN`); do not maintain a separate format-vs-target taxonomy. (3) New targets register via a static `Map<ExportTarget, ISerializer>` in the composition root — a lookup table, explicitly **not** a plugin framework.
- **Context:** Export is repeatable and multi-target (a resource may be exported to JSON and Obsidian, then re-exported after enrichment). Obsidian output is Markdown in a vault layout — a bundle profile, not a new byte syntax.
- **Why these choices:** Promoting to `EXPORTED` after every export is lossy and wrong for a repeatable multi-target operation, and creates a thorny state-machine question — avoided. A second enum (`ExportFormat` vs `ExportTarget`) is ceremony for three choices. Dynamic plugin discovery/sandboxing is unjustified for a small first-party team (Rule 12); adding a target is "one `ISerializer` + one `Map` entry."
- **Alternatives Considered:** (a) Promote to `EXPORTED` on export — rejected (lossy, ambiguous). (b) Separate `ExportFormat`/`ExportTarget` enums — rejected (over-engineering). (c) Plugin framework with discovery — rejected (justifiable only for third-party serializers, out of scope). (d) Overload `EXPORTED` for incremental bookkeeping — rejected; incremental uses a separate `IExportManifest` watermark (M7).
- **Tradeoffs:** (+) Idempotent, multi-target-correct export; minimal surface; trivial extensibility. (−) Re-exports redo work until incremental (M7) ships; `EXPORTED` carries little meaning.
- **Consequences:** Full-snapshot export is canonical for Beta-3; incremental is deferred to M7. See `EXPORT_ARCHITECTURE.md` §7, §11.

## ADR-014: Media Retention Policy & MediaJanitor
- **Status:** Active (Beta-3)
- **Decision:** Introduce a configurable, tiered media retention policy (`IMediaRetentionPolicy`) enforced by an MV3-safe, `chrome.alarms`-driven `MediaJanitor` (Layer 4). Default production policy: `fullMediaMode: 'cache'` with a `maxCacheBytes` soft cap and LRU eviction (via existing `IMediaMetadata.lastAccess`), `retainVideo: false`. Tiers: Tier 0 Knowledge (permanent), Tier 1 Thumbnail (future — generation deferred), Tier 2 Full-res bytes (cache), Tier 3 Pinned (permanent). The janitor is the only component that deletes media for capacity reasons and strictly honors the ADR-010 eviction invariant.
- **Context:** At 100k+ resources, full media is the only unbounded storage cost. A hard ceiling is required without destroying un-extracted knowledge.
- **Why this design:** Reuses `IMediaStore` (`list`/`statistics`/`lastAccess`/`delete`) with **no signature change**. LRU + cap + invariant give a bounded, predictable OPFS footprint. Thumbnail *generation* is image-processing work, not export work, so it is deferred — the policy supports the tier without forcing it into Beta-3.
- **Alternatives Considered:** (a) No retention (keep all) — rejected (TB growth). (b) Manual user deletion only — rejected (does not scale). (c) Generate thumbnails in Beta-3 — deferred (scope creep beyond export).
- **Tradeoffs:** (+) Bounded storage; no knowledge loss; reuses existing contracts. (−) Evicted bytes may be unrecoverable (mitigated by exporting before eviction and by pinning); a periodic background pass adds modest runtime cost.
- **Consequences:** Media storage is bounded and policy-governed. Ships as Milestone M6. See `EXPORT_ARCHITECTURE.md` §10.
