# Current State Dashboard

## Current Milestone
Beta-2 (OCR Engine)

## Current Objective
Phase 4D: Implement ENRICHED state promotion. After a successful OCR pass, update the resource state to ENRICHED and set completeness.ocr = true.

## Completed Milestones
- Alpha Stabilization (Sprints A0-A4)
- Beta-0 Phase 3.5 (Unified Persistence: IndexedDB + OPFS)
- MV3 Lifecycle & Orchestration Stabilization
- Extraction Unification
- Beta-1.5 (Enrichment Read Path)
- Beta-2 Phase 4A (OCR Engine)
- Beta-2 Phase 4B (Enrichment Cursor Checkpointing)
- **Beta-2 Phase 4C (Self-rescheduling)** — COMPLETE

## Active Branch
`main`

## Current Blockers
None.

## Recent Engineering Changes
- **Beta-2 Phase 4C (Self-rescheduling):** 
  - Made the enrichment pipeline a continuous background daemon.
  - Added `chrome.alarms` scheduling after each clean pass to survive MV3 service worker suspensions.
  - Implemented `_passInProgress` lock to prevent overlapping executions.
  - Integrated `handleAlarm` in the background worker entry point.
  - Added 13 new unit tests for self-rescheduling logic.

## Current Risks
- **CRITICAL - Missing `eng.traineddata` asset:** The Tesseract.js English language data file (~10 MB) is not bundled via npm. It must be manually downloaded and placed at `apps/extension/public/tesseract/lang/eng.traineddata` before building, otherwise OCR will fail at runtime.
- **Discovery Performance:** `MutationObserver` currently scans the entire document body, causing quadratic scaling on very large collections.
- **Eviction window on final-page completion:** If the service worker is evicted after the final page is checkpointed but before `deleteCrawlState` runs, the next activation will run an empty pass and delete the cursor cleanly. This is safe but sub-optimal.

## Current Technical Debt
- `Scheduler` and `MetricsCollector` lack automated unit test coverage.
- Legacy message bus uses raw string actions instead of strictly typed event unions.
- `IReconciliationReport` is logged but not persisted — no observable history of passes.

## Next Engineering Step
Beta-2 Phase 4D: ENRICHED state promotion. See `40_NEXT_TASK.md` for full scope and exit criteria.

## Definition of Current Success
The crawler consistently extracts and hydrates resources into IndexedDB/OPFS across a 100+ item scroll without MV3 eviction, duplicate data, or missing metrics. Enrichment reconciliation pass runs to completion via offscreen OCR document, producing transcriptions. A multi-minute OCR pass correctly survives an MV3 eviction by resuming from its last checkpointed page. The loop automatically reschedules itself in the background.
