# Next Task

## Current Milestone
Beta-1 (Milestone 1.5)

## Current Objective
Implement Enrichment Read Path, Resource Enumeration, Media Reconciliation, and Cleanup wiring.

## Why this task exists
The pipeline reliably produces `IResource` objects in the `HYDRATED` state with their associated media blobs persisted in OPFS. However, there is no pipeline to enumerate these un-enriched resources from IndexedDB, reconcile them with their media blobs from OPFS, and feed them into the next stage (OCR).

## Phase Status
- **Phase 1 (Contracts):** COMPLETE — `IResourceQuery`, `IEnrichmentSelection`, `IResourceQueryable` in `packages/types`.
- **Phase 2 (Storage Query Layer):** COMPLETE — `IndexedDbStorageEngine.queryResources()` implemented with schema v2 `by_state` index and `continuePrimaryKey` pagination.
- **Phase 3 (Background Wiring):** COMPLETE — `EnrichmentLoop` implemented, wired into startup, `MediaStore.cleanup()` wired as best-effort task.

## Phase 3 Scope
- Implement `apps/extension/src/background/enrichment-loop.ts` (new file).
- Loop must self-schedule via `setTimeout` between pages (MV3-safe — no perpetual `setInterval`).
- For each `HYDRATED` resource per page: fetch the OPFS blob via `MediaStore`, handle missing blobs gracefully (log + skip), advance to next page.
- Wire `EnrichmentLoop` into `apps/extension/src/background/index.ts`.
- No changes to `CrawlController`.

## Phase 3 Constraints
- **MV3 Safety:** Each page must yield the event loop with `await new Promise(r => setTimeout(r, 0))` between iterations.
- **Concurrency:** Use a separate readonly IndexedDB transaction per page — does not block the `CrawlController` write path.
- **Reconciliation:** Missing OPFS blobs (cleared by user) must be logged as diagnostics, not crashed on. Resource is skipped for this run.
- **No OCR:** Phase 3 feeds the reconciled `{ resource, blob }` pair to a stub/noop handler. OCR wiring is Phase 4.

## Phase 3 Files Expected to Change
- `apps/extension/src/background/enrichment-loop.ts` (new)
- `apps/extension/src/background/index.ts`

## Phase 3 Exit Criteria
- Unit tests pass for loop pagination, reconciliation, and missing-blob handling.
- Manual verification: `HYDRATED` resources enumerated without MV3 eviction.
- `CrawlController` performance not degraded.

## What immediately follows Phase 3
OCR Engine integration (Tesseract.js) to process the reconciled media blobs emitted by the enrichment loop.
