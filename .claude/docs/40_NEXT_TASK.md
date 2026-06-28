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

3. **OCR runtime architecture is frozen.** Tesseract.js v7 cannot run directly in the MV3
   service worker (spec-level prohibition on nested workers; Tesseract has no synchronous
   mode). `chrome.offscreen` with reason `WORKERS` is the selected runtime host. See ADR-009.

4. **Enrichment cursor checkpointing.** Before Beta-2 is declared complete, the last
   processed cursor position must be persisted to `IControlStateStore` so that a multi-minute
   OCR pass survives MV3 service worker eviction and resumes rather than restarting.

## Scope

### Phase 4A — OCR Engine (offscreen document architecture)

**Runtime model (ADR-009):** Tesseract.js runs inside a `chrome.offscreen` document.
`OcrEngine` (in the service worker) manages the offscreen lifecycle and dispatches image
data via `chrome.runtime.sendMessage`. The offscreen host script runs Tesseract and returns
`IContentBlock[]`. All storage writes happen in the service worker after the round-trip.

**Offscreen host (`src/offscreen/ocr-host.ts` + `ocr-host.html`):**
- On message `{ action: 'OCR_REQUEST', mediaId, buffer: ArrayBuffer, mimeType }`:
  - Lazy-initialize a single Tesseract worker on first call (load once, reuse).
  - All Tesseract WASM and language data files must be served from the extension package
    (no CDN). Configure `workerPath`, `corePath`, and `langPath` to local extension URLs.
  - Run `worker.recognize(blob)` → extract text.
  - Reply `{ success: true, blocks: IContentBlock[] }` using `BlockType.TRANSCRIPT`.
  - On any error: reply `{ success: false, error: string }`.
- On message `{ action: 'OCR_TERMINATE' }`:
  - Call `worker.terminate()` and clean up.

**`OcrEngine` class (`src/background/ocr-engine.ts`):**
- Implements `IOcrEngine` (`packages/types/src/ocr/ocr.ts` — unchanged).
- Constructor injects `IStorageEngine` and `IMediaStore`.
- `process(item: IEnrichmentWorkItem): Promise<void>` — the `onWorkItem` callback:
  - Ensure offscreen document exists:
    `chrome.offscreen.hasDocument()` → false → `chrome.offscreen.createDocument({ url, reasons: ['WORKERS'], justification })`.
  - Iterate media IDs in `item.resolvedMedia` where `IMediaMetadata.type === MediaType.IMAGE`.
  - For each image: `IMediaStore.get(id)` → `Blob | null`.
    - If null (blob evicted after reconciliation): log, increment failure count, continue.
  - Convert `Blob` → `ArrayBuffer` (`await blob.arrayBuffer()`).
  - `chrome.runtime.sendMessage({ action: 'OCR_REQUEST', mediaId, buffer, mimeType })` →
    await `{ success, blocks }`.
  - On failure response: log, continue (per-item isolation).
  - Accumulate all `blocks` across images.
  - After all images for the resource:
    - Append OCR blocks to `resource.content`.
    - Set `resource.completeness.ocr = true`.
    - Set `resource.state = ResourceState.ENRICHED`.
    - `storage.saveResource(resource)`.
  - Resources with no image media still advance: set `ocr = true`, `state = ENRICHED`, save.
- `terminate(): Promise<void>` — called by `index.ts` after `runPass()` resolves:
  - `chrome.runtime.sendMessage({ action: 'OCR_TERMINATE' })`.
  - `chrome.offscreen.closeDocument()`.

**Wiring (`src/background/index.ts`):**
- `const ocrEngine = idbEngine !== null ? new OcrEngine(idbEngine, mediaStore) : null`.
- Replace no-op `EnrichmentLoop` construction:
  `new EnrichmentLoop(idbEngine, mediaStore, ocrEngine !== null ? ocrEngine.process.bind(ocrEngine) : undefined)`.
- After `runPass()` resolves: call `ocrEngine?.terminate()`.

**Manifest (`manifest.json`):**
- Add `"offscreen"` to `permissions`.
- Add `content_security_policy`:
  `{ "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';" }`.

**Build (`vite.config.ts` or equivalent):**
- Copy Tesseract.js WASM core and `eng.traineddata` from `node_modules` into the extension
  dist directory as static assets so they are served from the extension origin.

### Phase 4B — Cursor Checkpointing
- Persist the last successfully processed cursor (resource id) to
  `IControlStateStore.saveCrawlState('enrichment_cursor', lastId)`.
- On next activation, load with `getCrawlState<string>('enrichment_cursor')` and pass as
  the initial cursor to `queryResources()`.
- Clear the checkpoint when `runPass()` completes cleanly (`completedCleanly: true`).

### Phase 4C — Self-rescheduling
- After a clean pass, schedule the next pass via `chrome.alarms.create()` with a configurable
  interval (default: 5 minutes).
- Do not use `setInterval` — MV3 unsafe.

## Constraints
- **No modification to `EnrichmentLoop` public API.** The `onWorkItem` injection point is the
  designed seam for OCR. Wire through it.
- **No modification to `IStorageEngine`.** Write to resources via the existing `saveResource()`.
- **No modification to `IOcrEngine`.** The offscreen dispatch is an implementation detail of
  `OcrEngine`; it must not surface at the interface level (ADR-009).
- **No modification to `IEnrichmentWorkItem`.** Pre-implementation review confirmed the
  existing fields (`resource`, `resolvedMedia`) are sufficient for OCR.
- **Memory.** Tesseract.js WASM module must be initialized once per offscreen document
  lifetime and reused. Do not re-initialize per image or per resource.
- **Bounded work.** Process one image at a time. Convert one blob to `ArrayBuffer`, dispatch,
  await result, then proceed. Do not accumulate all blobs in memory before dispatching.
- **Local-first.** All Tesseract WASM and language data must be bundled in the extension
  package. No CDN loading at runtime.

## Files Expected to Change
- `apps/extension/src/background/ocr-engine.ts` (new — `OcrEngine` class, offscreen dispatch)
- `apps/extension/src/offscreen/ocr-host.ts` (new — Tesseract runner, message handler)
- `apps/extension/src/offscreen/ocr-host.html` (new — offscreen document entry point)
- `apps/extension/src/background/index.ts` (wire `OcrEngine`; call `terminate()` after pass)
- `apps/extension/manifest.json` (add `offscreen` permission; add CSP with `wasm-unsafe-eval`)
- `apps/extension/vite.config.ts` (copy WASM + lang data to dist)
- `apps/extension/package.json` (add `tesseract.js` dependency)
- `apps/extension/tests/ocr-engine.test.ts` (new — unit tests)

## Exit Criteria
- Resources transition from `HYDRATED` to `ENRICHED` after successful OCR.
- `resource.completeness.ocr = true` is persisted.
- OCR failures on individual images are isolated — the pass continues.
- Cursor is checkpointed after each page; pass resumes correctly after worker eviction.
- Gate suite passes: typecheck, lint, tests, dependency-cruiser, build.
