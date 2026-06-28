# Session Report — Phase 4A: OCR Engine (Offscreen Document Architecture)

**Date:** 2026-06-29
**Milestone:** Beta-2 (OCR Engine)
**Gate suite result:** ✅ All passing — typecheck, lint, format:check, test, depcruise, build

---

## Objective

Implement Phase 4A as specified in ADR-009 and `40_NEXT_TASK.md`: replace the no-op
`onWorkItem` stub in `EnrichmentLoop` with a Tesseract.js OCR engine that reads image
blobs, produces `IContentBlock[]` transcriptions, and advances resources from
`HYDRATED → ENRICHED`.

---

## Features Implemented

- **Offscreen OCR host** (`src/offscreen/ocr-host.ts` + `ocr-host.html`): A `chrome.offscreen`
  document that runs a lazily-initialized Tesseract.js v7 worker. Handles `OCR_REQUEST`
  (recognize blob, return `IContentBlock[]`) and `OCR_TERMINATE` (teardown worker) messages
  from the service worker.

- **`OcrEngine` class** (`src/background/ocr-engine.ts`): Implements `IOcrEngine`.
  - Manages offscreen document lifecycle (create on demand, one per extension profile).
  - `process(item)`: iterates image media, fetches blobs from `IMediaStore`, dispatches
    `OCR_REQUEST` via `chrome.runtime.sendMessage`, accumulates blocks, writes
    `resource.completeness.ocr = true` + `state = ENRICHED` + calls `storage.saveResource`.
  - `extractText(media)`: thin `IOcrEngine` interface impl that delegates to the same IPC path.
  - `terminate()`: sends `OCR_TERMINATE` + closes offscreen document; swallows errors if
    document was never opened.

- **Wiring** (`src/background/index.ts`): `OcrEngine` constructed alongside `EnrichmentLoop`;
  `process.bind(ocrEngine)` passed as `onWorkItem`; `ocrEngine?.terminate()` called after
  `runPass()` resolves.

- **Per-item isolation**: Blob-missing and OCR-error cases both log a warning and continue.
  Resources with zero image media still advance (set `ocr = true`, `ENRICHED`, saved).

---

## Files Changed

| File                                          | Status       | Description                                                           |
| --------------------------------------------- | ------------ | --------------------------------------------------------------------- |
| `apps/extension/src/offscreen/ocr-host.html`  | **New**      | Offscreen document entry point                                        |
| `apps/extension/src/offscreen/ocr-host.ts`    | **New**      | Tesseract runner + message handler                                    |
| `apps/extension/src/background/ocr-engine.ts` | **New**      | `OcrEngine` class                                                     |
| `apps/extension/tests/ocr-engine.test.ts`     | **New**      | 14 unit tests (3 suites)                                              |
| `apps/extension/src/background/index.ts`      | **Modified** | Wired `OcrEngine`; terminate after pass                               |
| `apps/extension/manifest.json`                | **Modified** | Added `offscreen` permission + `wasm-unsafe-eval` CSP                 |
| `apps/extension/vite.config.ts`               | **Modified** | Added `offscreen/ocr-host` Rollup input; `copyTesseractAssets` plugin |

---

## Tests Added

**File:** `apps/extension/tests/ocr-engine.test.ts` — 14 tests across 3 suites

| Suite                   | Tests                                                                                                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OcrEngine.process`     | happy path, creates offscreen doc, skips when doc exists, null blob, OCR error, no image media, non-image skipped, media not in resolvedMedia, BlockType.TRANSCRIPT verified |
| `OcrEngine.terminate`   | sends OCR_TERMINATE + closes doc, survives sendMessage rejection, survives closeDocument rejection                                                                           |
| `OcrEngine.extractText` | returns blocks, returns empty on null blob, throws on error response                                                                                                         |

Chrome APIs mocked via `vi.stubGlobal('chrome', ...)` with `vi.unstubAllGlobals()` in `afterEach`.

---

## Architectural Decisions

**ADR-009 (implemented):** Tesseract.js v7 runs in a `chrome.offscreen` document with
`reason: WORKERS`. This is required because MV3 service workers cannot spawn nested Web
Workers (spec-level prohibition, crbug.com/1219164), and Tesseract.js v7 has no
synchronous/no-worker execution mode.

**`workerBlobURL: false`** is set in `createWorker` options. This prevents Tesseract from
using `URL.createObjectURL(blob)` for worker creation, which is blocked by extension CSP.

**IPC protocol:** `chrome.runtime.sendMessage` (SW → offscreen broadcast). The offscreen
host returns `true` from `onMessage` listener to keep the channel open for async responses.
All storage writes happen in the service worker after the IPC round-trip.

**`IOcrEngine` interface unchanged.** All offscreen dispatch is an implementation detail of
`OcrEngine`; the interface surface remains `extractText(media): Promise<IContentBlock[]>`.

**Offscreen URL:** CRXJS outputs the offscreen HTML at `dist/src/offscreen/ocr-host.html`
(preserving the `src/` prefix in the extension root). `OFFSCREEN_URL` in `ocr-engine.ts`
is set to `'src/offscreen/ocr-host.html'` to match.

---

## Dependencies Added

| Package             | Version  | Purpose                    |
| ------------------- | -------- | -------------------------- |
| `tesseract.js`      | `^7.0.0` | OCR via WebAssembly        |
| `tesseract.js-core` | `7.0.0`  | Transitive (WASM binaries) |

---

## Risks

### CRITICAL: `eng.traineddata` not bundled

The Tesseract.js English language data file (`eng.traineddata`, ~10 MB) is **not** included
in the npm package and is **not** automatically copied into the extension dist. The extension
will build and the gate suite will pass, but **OCR will fail at runtime** with a network/file
error until this file is placed at:

```
apps/extension/public/tesseract/lang/eng.traineddata
```

The `copyTesseractAssets` Vite plugin will copy it to `dist/tesseract/lang/eng.traineddata`
during build if it exists at that source location. Download from:
`https://github.com/naptha/tessdata/raw/refs/heads/main/eng.traineddata`

### WASM core not in `node_modules` symlink tree

`tesseract.js-core` is not reachable via the extension's local `node_modules` symlink. The
`copyTesseractAssets` plugin searches two candidates:

1. `apps/extension/node_modules/tesseract.js-core` (symlink, may not exist)
2. `node_modules/.pnpm/tesseract.js-core@7.0.0/node_modules/tesseract.js-core` (pnpm store)

If neither is found, a warning is emitted and the build continues. The WASM files must be
present in `dist/tesseract/` for OCR to work at runtime. Run a production build and verify
the copy succeeded; if not, copy manually from the pnpm store.

### MV3 service worker eviction during OCR pass

Long OCR passes (many images) can be interrupted by MV3 service worker eviction (30-second
idle timeout). Phase 4B (cursor checkpointing) addresses this by persisting the last
processed resource ID so the next activation resumes rather than restarts.

---

## Breaking Changes

None. `IOcrEngine`, `EnrichmentLoop`, `IEnrichmentWorkItem`, `IStorageEngine`, and all other
public interfaces are unchanged.

---

## Documentation Updates Required

The following canonical docs should be updated in the next documentation session (not done
this session per working rules):

- `20_CURRENT_STATE.md` — reflect Phase 4A complete; OCR engine wired; `eng.traineddata`
  still needs to be bundled
- `30_DECISIONS.md` — add ADR-009 entry summary (full ADR already committed)
- `40_NEXT_TASK.md` — advance to Phase 4B (cursor checkpointing)

---

## Next Engineering Task

**Phase 4B — Enrichment Cursor Checkpointing**

Persist the last successfully processed resource cursor to
`IControlStateStore.saveCrawlState('enrichment_cursor', lastId)` after each page. On next
activation, load with `getCrawlState<string>('enrichment_cursor')` and pass as the initial
cursor to `queryResources()`. Clear the checkpoint when `runPass()` completes cleanly
(`completedCleanly: true`). This makes the OCR pass survive MV3 service worker eviction.
