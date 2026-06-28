# SESSION REPORT — Beta-2 Phase 4C: Self-Rescheduling Enrichment Loop

## Summary

Phase 4C makes the enrichment pipeline a continuous background daemon rather than a one-shot startup task. After each clean pass, `EnrichmentLoop` schedules a `chrome.alarms` watchdog that re-triggers the next pass after a configurable interval (default 5 minutes). A boolean concurrency lock (`_passInProgress`) prevents overlapping executions if the alarm fires before the previous pass completes. The loop is MV3-safe: it never uses `setInterval`, relies entirely on `chrome.alarms` for periodic wake-up across service worker suspensions, and cooperates with the Phase 4B cursor checkpointing.

---

## Files Changed

### `apps/extension/src/background/enrichment-loop.ts`

- Added `static readonly ALARM_NAME = 'ke-enrichment-tick'`.
- Added private fields: `_active`, `_passInProgress`, `_intervalMinutes`.
- Added `start(intervalMinutes = 5): void` — activates the loop and runs the first pass immediately. Idempotent.
- Added `stop(): void` — deactivates the loop and clears any pending alarm.
- Added `handleAlarm(): void` — invoked by the alarm listener in `index.ts`.
- Added `private _trigger(): void` — guards against concurrent execution and inactive state, then calls `runPass()`. On clean completion schedules the next `chrome.alarms` watchdog.
- `runPass()` is unchanged from Phase 4B.

### `apps/extension/src/background/index.ts`

- **Alarm listener**: extended to handle `EnrichmentLoop.ALARM_NAME` by calling `enrichmentLoop?.handleAlarm()`. Existing `CrawlController.ALARM_NAME` branch is unmodified.
- **`startup()`**: replaced one-shot `enrichmentLoop.runPass().then(...).catch(...)` with `enrichmentLoop.start()`. The `ocrEngine?.terminate()` call was removed from this path — the loop now runs continuously and the OCR engine lifecycle is managed by MV3's natural service worker suspension.

### `apps/extension/tests/enrichment-loop.test.ts`

- Added `afterEach` import from vitest.
- Added 6 new `describe` blocks (13 new tests):
  - `self-rescheduling: schedules next pass after completion`
  - `self-rescheduling: duplicate scheduling prevented`
  - `self-rescheduling: concurrency control`
  - `self-rescheduling: alarm-triggered execution`
  - `self-rescheduling: stop`

---

## Design Decisions

### Self-scheduling inside `EnrichmentLoop`, alarm listener in `index.ts`

Per the MV3 constraint, all `chrome.alarms.onAlarm.addListener` calls must be synchronous top-level registrations in `index.ts`. This is preserved. The alarm name, interval, and concurrency logic live inside `EnrichmentLoop` — consistent with how `CrawlController.ALARM_NAME` and `resumeFromAlarm()` own their scheduling logic. `index.ts` is only an event router.

### `_trigger()` as the common entry point

Both `start()` and `handleAlarm()` delegate to `_trigger()`. This eliminates duplicated concurrency checks and ensures the lock/active guards apply identically for both the initial call and every alarm-triggered call.

### No alarm on unclean pass

If `runPass()` returns `completedCleanly: false`, no alarm is created. The loop pauses until the next browser restart or an explicit `start()`. This prevents alarm storms during sustained storage failures.

### Deferred promise pattern in tests

Three tests needed to control when `queryResources()` resolves mid-flight. The initial pattern captured the resolve function inside the Promise executor called asynchronously by `runPass()` — this failed because `runPass()` has an `await` before reaching `queryResources`, so the resolver wasn't available synchronously at the call site. Fix: hoist the `new Promise(...)` construction before `loop.start()` so the resolver is captured synchronously.

---

## Test Results

```
Test Files  4 passed (4)
     Tests  70 passed (70)   [57 Phase ≤4B + 13 Phase 4C]
  Duration  764ms
```

All 57 pre-existing tests continue to pass (zero regressions).

---

## Gate Suite Results

| Gate               | Result | Notes                                       |
| ------------------ | ------ | ------------------------------------------- |
| typecheck          | PASS   | No TypeScript errors                        |
| lint               | PASS   | No ESLint violations                        |
| tests              | PASS   | 70/70                                       |
| dependency-cruiser | PASS   | 106 modules, 150 deps — no layer violations |
| build              | PASS   | Extension bundle built in 359ms             |

---

## Known Limitations

- **No retry on unclean pass.** If a pass fails, the loop does not self-reschedule. Extension restart is required.
- **No runtime interval reconfiguration.** The interval is fixed at `start()` time.
- **OCR engine not explicitly terminated between passes.** The offscreen document lifecycle is now managed by MV3 suspension. If explicit teardown after user-initiated stop is required, that can be added in a later phase.

---

## Next Recommended Milestone

**Beta-2 Phase 4D — ENRICHED state promotion.**

`EnrichmentLoop` calls the OCR handler but never updates the resource `state` from `HYDRATED` to `ENRICHED` or sets `completeness.ocr = true`. Phase 4D should:

1. After a successful `ocrEngine.process()` call, write the updated resource back to `IStorageEngine` with `state: ResourceState.ENRICHED` and `completeness.ocr: true`.
2. Verify subsequent passes skip `ENRICHED` resources (already filtered by the `state: HYDRATED` query — may be a no-op).
3. Expose `resourcesEnriched` in `IReconciliationReport`.
4. Add tests for the state transition.
