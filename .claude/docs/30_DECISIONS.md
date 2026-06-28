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
