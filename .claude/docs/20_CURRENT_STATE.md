# Current State Dashboard

## Current Milestone
Beta-2 (OCR Engine)

## Current Objective
Phase 4B: Implement enrichment cursor checkpointing to ensure multi-minute OCR passes survive MV3 service worker eviction.

## Completed Milestones
- Alpha Stabilization (Sprints A0-A4)
- Beta-0 Phase 3.5 (Unified Persistence: IndexedDB + OPFS)
- MV3 Lifecycle & Orchestration Stabilization
- Extraction Unification
- Beta-1.5 (Enrichment Read Path)
- **Beta-2 Phase 4A (OCR Engine)** — COMPLETE

## Active Branch
`main`

## Current Blockers
None.

## Recent Engineering Changes
- **Beta-2 Phase 4A (OCR Engine):** Replaced the no-op `onWorkItem` stub in `EnrichmentLoop` with a Tesseract.js OCR engine.
- Implemented `OcrEngine` which routes OCR work to a `chrome.offscreen` document (reason: `WORKERS`) via `chrome.runtime.sendMessage` per ADR-009, bypassing the MV3 nested worker prohibition.
- Configured Vite to bundle Tesseract WASM/lang assets into the extension `dist`.
- Wired per-item failure isolation for missing blobs or OCR errors so the pass continues rather than aborting.
- All testing gates pass (added 14 unit tests for `OcrEngine`).

## Current Risks
- **CRITICAL - Missing `eng.traineddata` asset:** The Tesseract.js English language data file (~10 MB) is not bundled via npm. It must be manually downloaded and placed at `apps/extension/public/tesseract/lang/eng.traineddata` before building, otherwise OCR will fail at runtime.
- **Discovery Performance:** `MutationObserver` currently scans the entire document body, causing quadratic scaling on very large collections.
- **Enrichment cursor not checkpointed:** The enrichment pass restarts from the beginning on every service worker activation. A blocking concern now that OCR is wired (multi-minute passes lost on eviction). Must be addressed in Phase 4B.

## Current Technical Debt
- `Scheduler` and `MetricsCollector` lack automated unit test coverage.
- Legacy message bus uses raw string actions instead of strictly typed event unions.
- `EnrichmentLoop` runs once at startup; does not self-reschedule via alarms (deferred to Phase 4C).
- Enrichment cursor position not persisted to `IControlStateStore` across worker evictions.
- `IReconciliationReport` is logged but not persisted — no observable history of passes.

## Next Engineering Step
Beta-2 Phase 4B: Enrichment Cursor Checkpointing. See `40_NEXT_TASK.md` for full scope and exit criteria.

## Definition of Current Success
The crawler consistently extracts and hydrates resources into IndexedDB/OPFS across a 100+ item scroll without MV3 eviction, duplicate data, or missing metrics. Enrichment reconciliation pass runs to completion via offscreen OCR document, producing transcriptions and a valid `IReconciliationReport` on every worker activation.
