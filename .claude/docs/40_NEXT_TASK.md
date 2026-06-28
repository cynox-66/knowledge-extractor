# Next Task

## Current Milestone
Beta-1 (Milestone 1.5)

## Current Objective
Implement Enrichment Read Path, Resource Enumeration, Media Reconciliation, and Cleanup wiring.

## Why this task exists
The pipeline reliably produces `IResource` objects in the `HYDRATED` state with their associated media blobs persisted in OPFS. However, there is no pipeline to enumerate these un-enriched resources from IndexedDB, reconcile them with their media blobs from OPFS, and feed them into the next stage (OCR).

## Scope
- Extend `IStorageEngine` to support paginated enumeration filtered by `ResourceState`.
- Implement background enumeration loop for `HYDRATED` resources.
- Reconcile `IResource` records with `MediaStore` OPFS blobs.
- Wire the enumeration loop to run safely in the background worker.

## Out of Scope
- Implementing the OCR Engine itself.
- Semantic search or AI embeddings.
- Modifying the existing CrawlController loop.

## Files expected to change
- `packages/storage/src/indexeddb/indexeddb-storage.ts`
- `packages/types/src/storage/index.ts`
- `apps/extension/src/background/enrichment-loop.ts` (New file)
- `apps/extension/src/background/index.ts`

## Constraints
- **Performance:** Must use chunking/pagination to prevent OOM crashes when enumerating thousands of resources.
- **Concurrency:** Must not lock IndexedDB tables in a way that blocks the active `CrawlController` loop.
- **Reconciliation:** Must gracefully handle missing OPFS blobs (e.g., cleared by user).

## Definition of Done
- `IStorageEngine` successfully enumerates `HYDRATED` resources via pagination.
- A background process successfully iterates over these resources.
- The process successfully retrieves the corresponding OPFS blob for each resource.
- The active crawl loop's performance is not degraded during enumeration.

## Exit Criteria
- Unit tests pass for enumeration and pagination logic.
- Unit tests pass for reconciliation edge cases (missing blobs).
- Manual verification shows `HYDRATED` resources are accurately enumerated without MV3 eviction.

## Risks
- **MV3 Suspension:** If the enumeration loop runs synchronously for too long without yielding to the event loop, Chrome will terminate the service worker.

## What immediately follows after completion
Implementation of the offline OCR Engine (Tesseract.js integration) to process the enumerated and reconciled media blobs.
