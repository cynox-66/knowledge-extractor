# Next Task

## Current Milestone
Beta-2 (OCR Engine)

## Current Objective
Phase 4B — Enrichment Cursor Checkpointing. Persist the `enrichment_cursor` to durable storage so the OCR enrichment pass can resume from the last successfully processed resource after an MV3 service worker eviction, rather than restarting from the beginning.

## Why this task exists
With Phase 4A complete, `EnrichmentLoop` now performs multi-minute OCR processing via the `chrome.offscreen` document. Because MV3 background service workers are routinely evicted by the browser (e.g., after 30 seconds of idleness), a long OCR pass is almost guaranteed to be interrupted. Without checkpointing, the pass will infinitely restart on every activation and never complete.

## Pre-conditions (must be verified at session start)
1. **Phase 4A is complete.** The OCR engine is actively running and processing resources inside the `onWorkItem` callback.
2. **`IControlStateStore` is available.** The store must support writing arbitrary key-value crawl state via `saveCrawlState()`.

## Scope

### Phase 4B — Enrichment Cursor Checkpointing
- **Persist Cursor:** After successfully processing a page of resources in `EnrichmentLoop.runPass()`, persist the last successfully processed cursor (resource id) to `IControlStateStore.saveCrawlState('enrichment_cursor', lastId)`.
- **Load Cursor:** On the next service worker activation, load the cursor with `getCrawlState<string>('enrichment_cursor')` and pass it as the initial cursor (i.e. `continuePrimaryKey`) to `queryResources()`.
- **Clear Cursor:** Clear the checkpoint (`deleteCrawlState('enrichment_cursor')`) when `runPass()` completes cleanly (`completedCleanly: true`).

## Constraints
- **Performance:** Do not write to IndexedDB on every single resource. Batch the checkpoint update to run once per page loop iteration.
- **No modification to `IStorageEngine` interface:** Use the existing `IControlStateStore` API.

## Files Expected to Change
- `apps/extension/src/background/enrichment-loop.ts` (Implement checkpointing logic)
- `apps/extension/tests/enrichment-loop.test.ts` (Add tests for cursor persistence and recovery)

## Risks
- **Data Race on Eviction:** Ensure the cursor is committed to the control state store before the page loop yields to the event loop, minimizing the window where a service worker eviction could lose track of processed items.
- **Infinite Loops:** Ensure the cursor logic does not cause `queryResources` to repeatedly fetch the same page if an error occurs.

## Testing Requirements
- Unit tests for `EnrichmentLoop` must verify that the cursor is correctly saved to `IControlStateStore` during a pass.
- Unit tests must verify that `EnrichmentLoop` initializes `queryResources` with the recovered cursor upon startup.
- Unit tests must verify the cursor is cleared after a successful full pass.

## Exit Criteria
- The last processed resource ID is checkpointed after each page.
- `EnrichmentLoop` correctly resumes from the persisted cursor on the next worker activation.
- The cursor is cleared upon full completion of the pass.
- Gate suite passes: typecheck, lint, tests, dependency-cruiser, build.
