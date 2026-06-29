# Current State Dashboard

## Current Milestone
Beta-3 (Knowledge Ownership & Export)

## Current Objective
Transition to M2: Implement packages/export with JSON/NDJSON serialization.

## Completed Milestones
- Alpha Stabilization (Sprints A0-A4)
- Beta-0 Phase 3.5 (Unified Persistence: IndexedDB + OPFS)
- MV3 Lifecycle & Orchestration Stabilization
- Extraction Unification
- Beta-1.5 (Enrichment Read Path)
- Beta-2 Phase 4A (OCR Engine)
- Beta-2 Phase 4B (Enrichment Cursor Checkpointing)
- Beta-2 Phase 4C (Self-rescheduling)
- Beta-2 Phase 4D (ENRICHED state promotion & Runtime Wiring)
- **Beta-3 Milestone M1 (Export Contracts)** — COMPLETE

## Active Branch
`main`

## Current Blockers
None.

## Recent Engineering Changes
- **Beta-3 Milestone M1:** 
  - Defined Beta-3 export contracts in `packages/types/src/export/exporter.ts`.
  - Added `IMediaRetentionPolicy` in `packages/types/src/storage/retention.ts`.
  - Removed deprecated `IExporter` and `ExportFormat`.

## Current Risks
- **CRITICAL - Missing `eng.traineddata` asset:** The Tesseract.js English language data file (~10 MB) is not bundled via npm. It must be manually downloaded and placed at `apps/extension/public/tesseract/lang/eng.traineddata` before building, otherwise OCR will fail at runtime.
- **Discovery Performance:** `MutationObserver` currently scans the entire document body, causing quadratic scaling on very large collections.
- **Eviction window on final-page completion:** If the service worker is evicted after the final page is checkpointed but before `deleteCrawlState` runs, the next activation will run an empty pass and delete the cursor cleanly. This is safe but sub-optimal.
- **Database contention:** Per-resource write transactions in the enrichment loop could cause contention with foreground crawler writes.

## Current Technical Debt
- `Scheduler` and `MetricsCollector` lack automated unit test coverage.
- Legacy message bus uses raw string actions instead of strictly typed event unions.
- `IReconciliationReport` is logged but not persisted — no observable history of passes.

## Next Engineering Step
Milestone M2 — `packages/export` + projector + JSON (NDJSON) serializer (Layer 2). See `40_NEXT_TASK.md`.

## Definition of Current Success
The extraction and enrichment pipelines are stable and self-rescheduling. The Beta-3 export contracts are locked. The next phase will implement the formatting and projection logic to prepare for file output.
