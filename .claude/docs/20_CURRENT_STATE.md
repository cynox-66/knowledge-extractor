# Current State Dashboard

## Current Milestone
Beta-3 (Knowledge Ownership & Export)

## Current Objective
Transition to M5: ObsidianSerializer — new export target.

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
- Beta-3 Milestone M2 (ResourceProjector + JSON Serializer)
- Beta-3 Milestone M3 (Markdown Serializer)
- **Beta-3 Milestone M4 (Export Orchestration End-to-End)** — COMPLETE

## Active Branch
`main`

## Current Blockers
None.

## Recent Engineering Changes
- **Beta-3 Milestone M4:**
  - Implemented `ExportCoordinator` (MV3-safe, self-yielding paginated export loop with progress persistence, cancellation, and alarm-based resumability).
  - Implemented `ExportWriter` (artifact assembly, binary byte resolution from `IMediaStore`, download delivery).
  - Implemented `zip-writer.ts` (dependency-free STORE-method ZIP encoder).
  - Implemented `ChromeDownloadGateway` (base64 `data:` URL delivery via `chrome.downloads`).
  - Implemented `createSerializerRegistry()` (JSON + Markdown; Obsidian deferred to M5).
  - Wired the full export subsystem in `apps/extension/src/background/index.ts` with `START_EXPORT`, `CANCEL_EXPORT`, `GET_EXPORT_PROGRESS` message handlers and alarm resume.
  - Added Export panel to the popup UI.
  - Added `downloads` permission to `manifest.json`.

## Current Risks
- **CRITICAL - Missing `eng.traineddata` asset:** The Tesseract.js English language data file (~10 MB) is not bundled via npm. It must be manually downloaded and placed at `apps/extension/public/tesseract/lang/eng.traineddata` before building, otherwise OCR will fail at runtime.
- **Discovery Performance:** `MutationObserver` currently scans the entire document body, causing quadratic scaling on very large collections.
- **Eviction window on final-page completion:** If the service worker is evicted after the final page is checkpointed but before `deleteCrawlState` runs, the next activation will run an empty pass and delete the cursor cleanly. This is safe but sub-optimal.
- **In-memory artifact assembly:** The full NDJSON/ZIP artifact is assembled in memory before download (bounded per-tick, but ceiling is artifact size). A streaming sink can replace `ExportWriter` behind its seam in a future milestone.
- **Resume re-runs rather than byte-resumes:** `resume()` re-drives from the dataset start rather than the checkpointed page to guarantee a complete artifact (the interrupted attempt never delivered). This is safe and read-only idempotent, but redundant work is performed.

## Current Technical Debt
- `Scheduler` and `MetricsCollector` lack automated unit test coverage.
- Legacy message bus uses raw string actions instead of strictly typed event unions.
- `IReconciliationReport` is logged but not persisted — no observable history of passes.
- STORE-only ZIP (no compression); markdown bundles are uncompressed.
- Export `localPath` still lacks file extensions — the writer can suffix extensions from MIME type in a future optimisation.

## Next Engineering Step
Milestone M5 — `ObsidianSerializer` (new export target). See `40_NEXT_TASK.md`.

## Definition of Current Success
The full export pipeline is production-wired: ENRICHED resources can be exported as NDJSON or Markdown ZIP via the popup UI. The pipeline is MV3-safe, resumable after worker eviction, and architecturally isolated — Layer 2 (`packages/export`) remains pure.
