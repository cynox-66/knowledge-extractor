# Next Task

## Current Milestone
Beta-2 (OCR Engine)

## Current Objective
Phase 4D — ENRICHED state promotion. After a successful OCR pass, update the resource state from HYDRATED to ENRICHED and set completeness.ocr = true.

## Why this task exists
Currently, `EnrichmentLoop` processes items via the OCR handler but does not mutate the resource to reflect the new state. This results in the same resources being repeatedly processed on every enrichment pass. We must durably update the resource to `ENRICHED` so it is filtered out of future `HYDRATED` queries.

## Pre-conditions (must be verified at session start)
1. **Phase 4C is complete.** The enrichment loop successfully self-reschedules.

## Scope

### Phase 4D — ENRICHED state promotion
- **Resource Update:** After a successful `ocrEngine.process()` call in `EnrichmentLoop`, write the updated resource back to `IStorageEngine` with `state: ResourceState.ENRICHED` and `completeness.ocr: true`.
- **Query Verification:** Verify that subsequent passes skip `ENRICHED` resources (they should be filtered out by the `state: ResourceState.HYDRATED` query).
- **Reporting:** Expose `resourcesEnriched` in `IReconciliationReport`.
- **Testing:** Add unit tests to verify the state transition.

## Constraints
- **Performance:** Do not introduce severe blocking in the `EnrichmentLoop` when saving state, though saving per-resource might be necessary. Keep transactions localized.
- **Error Handling:** If saving the state fails, the resource should not be considered successfully enriched.

## Files Expected to Change
- `apps/extension/src/background/enrichment-loop.ts`
- `apps/extension/tests/enrichment-loop.test.ts`
- `@knowledge-extractor/types` (to update `IReconciliationReport`)

## Risks
- **Database contention:** Writing to IndexedDB for each enriched resource could contend with the foreground crawl extraction writes. Ensure the update transactions are short-lived.

## Exit Criteria
- Resources correctly transition to `ResourceState.ENRICHED` after successful OCR.
- `completeness.ocr` is correctly set to true.
- `resourcesEnriched` is tracked in the pass report.
- Previously enriched resources are not re-processed on the next loop tick.
- Gate suite passes: typecheck, lint, tests, dependency-cruiser, build.
