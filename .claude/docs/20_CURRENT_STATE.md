# Current State Dashboard

## Current Milestone
Beta-3 (Knowledge Ownership & Export)

## Current Objective
Transition to M6: Media Retention Policy + MediaJanitor.

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
- **Beta-3 Milestone M5 (ObsidianSerializer)** — COMPLETE

## Active Branch
`main`

## Current Blockers
None.

## Recent Engineering Changes
- **Beta-3 Milestone M5:**
  - Implemented `ObsidianSerializer` with vault layout, `attachments/` directory, wikilinks, and tags.
  - Extracted `sanitizePath()` helper into `packages/export/src/path-utils.ts` (shared).
  - Added `ObsidianSerializer` to `createSerializerRegistry()`.
  - Added Obsidian Vault option to the popup Export panel.
  - Successfully validated the ADR-013 architectural claim: adding a new export target required exactly one new serializer and one registry entry, with zero modifications to the core export pipeline.

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

## Next Engineering Step
Milestone M6 — Media Retention Policy + MediaJanitor. See `40_NEXT_TASK.md`.

## Definition of Current Success
The full export pipeline is production-wired and extensible. The Obsidian export target was successfully added without pipeline modifications, validating the architectural design. The next phase will implement media retention policies to cap unbounded growth in long-running collections.
