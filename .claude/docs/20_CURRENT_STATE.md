# Current State Dashboard

## Current Milestone
Beta-2 (OCR Engine)

## Current Objective
Integrate Tesseract.js OCR to process reconciled media blobs emitted by `EnrichmentLoop`,
writing transcription results back to `IResource` and advancing resources from
`HYDRATED` → `ENRICHED`.

## Completed Milestones
- Alpha Stabilization (Sprints A0-A4)
- Beta-0 Phase 3.5 (Unified Persistence: IndexedDB + OPFS)
- MV3 Lifecycle & Orchestration Stabilization
- Extraction Unification
- **Beta-1.5 (Enrichment Read Path)** — COMPLETE

## Active Branch
`main`

## Current Blockers
None.

## Recent Engineering Changes
- **Beta-1.5 Phase 1:** Added `IResourceQuery`, `IEnrichmentSelection`, and `IResourceQueryable`
  contracts to `packages/types`. Added `IReconciliationReport` and `IEnrichmentWorkItem`.
- **Beta-1.5 Phase 2:** Implemented `IResourceQueryable` on `IndexedDbStorageEngine`. Schema
  bumped to v2 with `by_state` secondary index on `resources.state`. `queryResources()` uses
  `continuePrimaryKey` cursor for O(pageSize) bounded-memory pagination.
- **Beta-1.5 Phase 3:** Implemented `EnrichmentLoop` with MV3-safe per-page `setTimeout(0)`
  yielding. Produces `IReconciliationReport`. Wired into startup after `controller.init()`.
  `MediaStore.cleanup()` runs sequentially before `runPass()` to eliminate index race.
- **Beta-1.5 Post-review fixes:** Added `resourcesFailed` counter to `IReconciliationReport`;
  per-item `onWorkItem` failures now increment `resourcesFailed` and continue rather than
  aborting the entire pass. Sequential `cleanup() → runPass()` startup ordering replaces
  the previous concurrent fire-and-forget.
- **Beta-2 Architecture Freeze (ADR-009):** Verified that Tesseract.js v7 cannot run directly
  in the MV3 background service worker. Two spec-level blockers: (1) service workers cannot
  spawn nested Web Workers (crbug.com/1219164); (2) Tesseract.js v7 has no synchronous
  execution mode. Selected `chrome.offscreen` (reason: `WORKERS`) as the runtime host for
  Tesseract execution. `IOcrEngine`, `EnrichmentLoop`, and all storage contracts remain
  unchanged. Architecture documented in ADR-009.

## Current Risks
- **Discovery Performance:** `MutationObserver` currently scans the entire document body,
  causing quadratic scaling on very large collections.
- **Enrichment cursor not checkpointed:** The enrichment pass restarts from the beginning on
  every service worker activation. Acceptable without OCR (pass is fast); becomes a blocking
  concern once OCR is wired (multi-minute passes lost on eviction). Must be addressed in Beta-2.

## Current Technical Debt
- `Scheduler` and `MetricsCollector` lack automated unit test coverage.
- Legacy message bus uses raw string actions instead of strictly typed event unions.
- `EnrichmentLoop` runs once at startup; does not self-reschedule via alarms (deferred to Beta-2).
- Enrichment cursor position not persisted to `IControlStateStore` across worker evictions.
- `IReconciliationReport` is logged but not persisted — no observable history of passes.

## Next Engineering Step
Beta-2 Phase 4A: OCR Engine implementation using `chrome.offscreen` (architecture frozen in
ADR-009). See `40_NEXT_TASK.md` for full scope, file map, and exit criteria.

## Definition of Current Success
The crawler consistently extracts and hydrates resources into IndexedDB/OPFS across a 100+ item
scroll without MV3 eviction, duplicate data, or missing metrics. Enrichment reconciliation pass
runs to completion and produces a valid `IReconciliationReport` on every worker activation.
