# Current State Dashboard

## Current Milestone
Beta-3 (Knowledge Ownership & Export)

## Current Objective
Transition to M7: Incremental export + download-on-demand.

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
- Beta-3 Milestone M4 (Export Orchestration End-to-End)
- Beta-3 Milestone M5 (ObsidianSerializer)
- **Beta-3 Milestone M6 (Media Retention Policy + MediaJanitor)** — COMPLETE

## Active Branch
`main`

## Current Blockers
None.

## Recent Engineering Changes
- **Beta-3 Milestone M6:**
  - Implemented `MediaJanitor` as an alarm-driven, MV3-safe background process.
  - Enforced `IMediaRetentionPolicy` limits using LRU eviction based on `lastAccess`.
  - Architecturally guaranteed ADR-010 ("Knowledge is permanent. Media is policy-managed") by building the eligible eviction set strictly from ENRICHED and EXPORTED resources.
  - Pinned resources are safely exempted from eviction.
  - Eviction is additive-only (metadata in `IResource` is untouched) and isolated per-blob.

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
- YAML value serialization logic is duplicated across `MarkdownSerializer` and `ObsidianSerializer`.
- Cross-resource same-author wikilinks not implemented (would require a global index outside the pure projection layer).
- Policy configuration is static at startup (hard-coded 500 MB).

## Next Engineering Step
Milestone M7 — Incremental export + download-on-demand. See `40_NEXT_TASK.md`.

## Definition of Current Success
The media lifecycle is fully policy-managed and safe for long-running deployments. ADR-010 is validated: resources exist permanently as knowledge, while raw media blobs are dynamically evicted based on limits, state, and user pinning.
