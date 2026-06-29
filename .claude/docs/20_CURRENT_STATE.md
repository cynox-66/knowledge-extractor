# Current State Dashboard

## Current Milestone
Beta-3 (Knowledge Ownership & Export)

## Current Objective
Transition to M4: Export Orchestration End-to-End (Layer 4).

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
- Beta-3 Milestone M1 (Export Contracts)
- **Beta-3 Milestone M2 (ResourceProjector + JSON Serializer)** — COMPLETE
- **Beta-3 Milestone M3 (Markdown Serializer)** — COMPLETE

## Active Branch
`main`

## Current Blockers
None.

## Recent Engineering Changes
- **Beta-3 Milestones M2 + M3:** 
  - Created `packages/export` (Layer 2).
  - Implemented `ResourceProjector` (pure transformation).
  - Implemented `JsonSerializer` (NDJSON format).
  - Implemented `MarkdownSerializer` (Markdown output).
  - Created reusable `block-renderer.ts`.
  - Added dependency-cruiser rules ensuring `export` and `storage` isolation.

## Current Risks
- **CRITICAL - Missing `eng.traineddata` asset:** The Tesseract.js English language data file (~10 MB) is not bundled via npm. It must be manually downloaded and placed at `apps/extension/public/tesseract/lang/eng.traineddata` before building, otherwise OCR will fail at runtime.
- **Discovery Performance:** `MutationObserver` currently scans the entire document body, causing quadratic scaling on very large collections.
- **Eviction window on final-page completion:** If the service worker is evicted after the final page is checkpointed but before `deleteCrawlState` runs, the next activation will run an empty pass and delete the cursor cleanly. This is safe but sub-optimal.
- **Database contention:** Per-resource write transactions in the enrichment loop could cause contention with foreground crawler writes.

## Current Technical Debt
- `Scheduler` and `MetricsCollector` lack automated unit test coverage.
- Legacy message bus uses raw string actions instead of strictly typed event unions.
- `IReconciliationReport` is logged but not persisted — no observable history of passes.
- Generated `localPath` in exports currently lacks file extensions. (To be resolved by ExportWriter in M4).

## Next Engineering Step
Milestone M4 — Export Orchestration End-to-End (Layer 4). See `40_NEXT_TASK.md`.

## Definition of Current Success
The extraction and enrichment pipelines are stable. The export domain layer (M1) and transformation layer (M2-M3) are completely implemented and isolated. The next phase will wire these components together into an orchestration loop in the background worker.
