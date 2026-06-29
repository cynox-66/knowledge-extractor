# Current State Dashboard

## Current Milestone
Beta-3 (Knowledge Ownership & Export) — **COMPLETE**

## Current Objective
Transition to Beta-3 Closeout / Architecture Review.

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
- Beta-3 Milestone M6 (Media Retention Policy + MediaJanitor)
- **Beta-3 Milestone M7 (Incremental Export)** — COMPLETE

## Active Branch
`main`

## Current Blockers
None.

## Recent Engineering Changes
- **Beta-3 Milestone M7 (Incremental Export):**
  - Implemented `IExportManifest` for durable per-target watermark tracking.
  - Added incremental export capability to `ExportCoordinator`, which reliably filters out previously exported resources using deterministic `source.extractedAt` checks.
  - Implemented `embed-remote` mode for on-demand media re-fetching, with graceful fallback to remote links if fetching fails (due to network or authentication barriers).
  - All architecture invariants (purity of `packages/export`, MV3-safe orchestration, additive changes) rigorously preserved.

## Current Risks
- **CRITICAL - Missing `eng.traineddata` asset:** The Tesseract.js English language data file (~10 MB) is not bundled via npm. It must be manually downloaded and placed at `apps/extension/public/tesseract/lang/eng.traineddata` before building, otherwise OCR will fail at runtime.

## Current Technical Debt
- `Scheduler` and `MetricsCollector` lack automated unit test coverage.
- Legacy message bus uses raw string actions instead of strictly typed event unions.
- `IReconciliationReport` is logged but not persisted — no observable history of passes.
- STORE-only ZIP (no compression); markdown bundles are uncompressed.
- Export `localPath` still lacks file extensions — the writer can suffix extensions from MIME type in a future optimisation.
- YAML value serialization logic is duplicated across `MarkdownSerializer` and `ObsidianSerializer`.
- Cross-resource same-author wikilinks not implemented (would require a global index outside the pure projection layer).
- Policy configuration is static at startup (hard-coded 500 MB).
- Incremental filter granularity uses `extractedAt` rather than an update timestamp.
- No UI mechanism to manually reset the manifest watermark.

## Next Engineering Step
Beta-3 Closeout / Architecture Review. See `40_NEXT_TASK.md`.

## Definition of Current Success
Beta-3 is fully architecturally validated. Knowledge is permanent (ADR-010), the pure layer handles export projection safely (ADR-011, ADR-012), new serializers are trivial to add (ADR-013), and media management is governed purely by policy (ADR-014). The system is highly robust and prepared for the next architecture phase.
