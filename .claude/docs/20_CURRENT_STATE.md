# Current State Dashboard

## Current Milestone
Beta-1 (Milestone 1.5)

## Current Objective
Implement Enrichment Read Path, Resource Enumeration, Media Reconciliation, and Cleanup wiring to feed `HYDRATED` resources into the OCR pipeline.

## Completed Milestones
- Alpha Stabilization (Sprints A0-A4)
- Beta-0 Phase 3.5 (Unified Persistence: IndexedDB + OPFS)
- MV3 Lifecycle & Orchestration Stabilization
- Extraction Unification

## Active Branch
`main`

## Current Blockers
None.

## Recent Engineering Changes
- Integrated `IndexedDbStorageEngine` replacing `InMemoryStorage`.
- Added OPFS blob backend and `MediaCaptureCoordinator`.
- Purged outdated historical documentation and established `.claude/docs` source of truth.
- **Beta-1 Phase 1:** Added `IResourceQuery`, `IEnrichmentSelection`, and `IResourceQueryable` contracts to `packages/types`.
- **Beta-1 Phase 2:** Implemented `IResourceQueryable` on `IndexedDbStorageEngine`. Schema bumped to v2 with `by_state` index on `resources.state`. `queryResources()` uses `continuePrimaryKey` cursor for O(pageSize) bounded-memory pagination.
- **Beta-1 Phase 3:** Implemented `EnrichmentLoop` in `apps/extension/src/background/enrichment-loop.ts`. Wired into startup: runs a reconciliation pass after `controller.init()`, produces `IReconciliationReport`, yields between pages via `setTimeout(0)`. `MediaStore.cleanup()` runs as a best-effort startup task.

## Current Risks
- **Discovery Performance:** `MutationObserver` currently scans the entire document body, causing quadratic scaling on very large collections.
- **OCR Integration:** Phase 4 must replace the no-op `onWorkItem` stub with the Tesseract.js OCR engine without modifying `EnrichmentLoop` itself.

## Current Technical Debt
- `Scheduler` and `MetricsCollector` lack automated unit test coverage.
- Legacy message bus uses raw string actions instead of strictly typed event unions across the board.
- `EnrichmentLoop` runs exactly once at startup; it does not self-reschedule (deferred to Phase 4 / alarm integration).

## Next Engineering Step
Beta-2: OCR Engine integration — replace the no-op `onWorkItem` stub with Tesseract.js, processing reconciled `IEnrichmentWorkItem` blobs.

## Definition of Current Success
The crawler consistently extracts and hydrates resources into IndexedDB/OPFS across a 100+ item scroll without MV3 eviction, duplicate data, or missing metrics.
