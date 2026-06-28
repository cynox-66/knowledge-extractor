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

## Current Risks
- **Discovery Performance:** `MutationObserver` currently scans the entire document body, causing quadratic scaling on very large collections.
- **MV3 Suspension during Read Loop:** Paginated enrichment reads could block the background worker if not properly chunked, leading to Chrome eviction.

## Current Technical Debt
- `Scheduler` and `MetricsCollector` lack automated unit test coverage.
- Legacy message bus uses raw string actions instead of strictly typed event unions across the board.

## Next Engineering Step
Build the paginated `IStorageEngine` enumeration logic and Media Reconciliation loop (see `40_NEXT_TASK.md`).

## Definition of Current Success
The crawler consistently extracts and hydrates resources into IndexedDB/OPFS across a 100+ item scroll without MV3 eviction, duplicate data, or missing metrics.
