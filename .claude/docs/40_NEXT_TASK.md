# Next Task

## Current Milestone
Beta-2 (OCR Engine)

## Current Objective
Replace the no-op `onWorkItem` stub in `EnrichmentLoop` with a Tesseract.js OCR engine that
reads media blobs, produces text transcriptions, and writes them back to `IResource`,
advancing resources from `HYDRATED` → `ENRICHED`.

## Why this task exists
`EnrichmentLoop` now reliably delivers `IEnrichmentWorkItem` objects to its `onWorkItem`
callback. The callback is currently a no-op. Beta-2 wires in the OCR engine so that
reconciled image blobs are processed and their transcriptions are stored.

## Pre-conditions (must be verified at session start)

1. **Per-item error isolation is in place.** OCR failures are routine (corrupted images,
   WASM OOM, Tesseract timeout). The loop already isolates per-item failures via
   `resourcesFailed` — confirm this before writing any OCR code.

2. **Sequential startup ordering is in place.** `cleanup()` completes before `runPass()`
   begins — confirmed in Beta-1.5.

3. **Enrichment cursor checkpointing.** Before Beta-2 is declared complete, the last
   processed cursor position must be persisted to `IControlStateStore` so that a multi-minute
   OCR pass survives MV3 service worker eviction and resumes rather than restarting.

## Scope

### Phase 4a — OCR Engine
- Implement `OcrEngine` class in `apps/extension/src/background/`.
- Dependencies: `IMediaStore` (for `get()` byte access), `IStorageEngine` (to write
  transcription results via `saveResource()`).
- Wire: `new EnrichmentLoop(idbEngine, mediaStore, ocrEngine.process.bind(ocrEngine))` in
  `apps/extension/src/background/index.ts`.
- On success: update `resource.content` with OCR text blocks, set `resource.completeness.ocr = true`,
  transition state `HYDRATED → ENRICHED` via `storage.saveResource()`.
- On `get()` returning null (blob evicted after reconciliation): log, count as failed, continue.

### Phase 4b — Cursor Checkpointing
- Persist the last successfully processed cursor (resource id) to
  `IControlStateStore.saveCrawlState('enrichment_cursor', lastId)`.
- On next activation, load with `getCrawlState<string>('enrichment_cursor')` and pass as
  the initial cursor to `queryResources()`.
- Clear the checkpoint when `runPass()` completes cleanly (`completedCleanly: true`).

### Phase 4c — Self-rescheduling
- After a clean pass, schedule the next pass via `chrome.alarms.create()` with a configurable
  interval (default: 5 minutes).
- Do not use `setInterval` — MV3 unsafe.

## Constraints
- **No modification to `EnrichmentLoop` public API.** The `onWorkItem` injection point is the
  designed seam for OCR. Wire through it.
- **No modification to `IStorageEngine`.** Write to resources via the existing `saveResource()`.
- **MV3 safety.** OCR is CPU-intensive. Each image must yield the event loop after processing
  (`await yieldToEventLoop()` or equivalent) to prevent the service worker from being terminated.
- **Memory.** Tesseract.js WASM module must be loaded once and reused. Do not re-initialize
  per image.
- **Bounded work.** Process one image at a time. Do not accumulate all blobs in memory.

## Files Expected to Change
- `apps/extension/src/background/ocr-engine.ts` (new)
- `apps/extension/src/background/index.ts` (wire OCR engine into enrichment loop)
- `apps/extension/tests/ocr-engine.test.ts` (new)
- `apps/extension/package.json` (add `tesseract.js` dependency)
- `packages/types/src/enrichment/enrichment.ts` (possibly extend `IEnrichmentWorkItem` if OCR
  needs additional context — evaluate at implementation time)

## Exit Criteria
- Resources transition from `HYDRATED` to `ENRICHED` after successful OCR.
- `resource.completeness.ocr = true` is persisted.
- OCR failures on individual images are isolated — the pass continues.
- Cursor is checkpointed after each page; pass resumes correctly after worker eviction.
- Gate suite passes: typecheck, lint, tests, dependency-cruiser, build.
