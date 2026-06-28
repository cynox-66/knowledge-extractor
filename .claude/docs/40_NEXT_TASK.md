# Next Task

## Current Milestone
Beta-2 (OCR Engine)

## Current Objective
Phase 4C — Self-rescheduling. Automatically schedule the next OCR enrichment pass after a successful run using `chrome.alarms`.

## Why this task exists
Currently, `EnrichmentLoop` only runs once on service worker startup. Since the OCR enrichment process is a background daemon task, it should proactively wake up and process newly hydrated resources on a regular interval without requiring the user to restart the extension.

## Pre-conditions (must be verified at session start)
1. **Phase 4B is complete.** The enrichment loop correctly checkpoints its cursor and survives evictions.
2. **MV3 Restrictions.** `setInterval` cannot be used in background service workers. All periodic scheduling must use `chrome.alarms`.

## Scope

### Phase 4C — Self-rescheduling
- **Schedule Next Pass:** After a clean pass (`completedCleanly: true`), schedule the next pass using `chrome.alarms.create()` with a configurable interval (default: 5 minutes).
- **Alarm Listener:** Listen for this specific alarm in `apps/extension/src/background/index.ts` and invoke `runPass()`.
- **Concurrency Control:** Ensure that if an alarm fires while an enrichment pass is already active, the new pass is skipped or queued to avoid overlapping executions.

## Constraints
- **Do not use `setInterval`.** It is unsafe in Manifest V3 service workers.
- **Centralized Event Listeners.** All `chrome.alarms.onAlarm.addListener` registrations must happen synchronously at the top level of `index.ts`.

## Files Expected to Change
- `apps/extension/src/background/index.ts` (Add alarm creation and listener)

## Risks
- **Overlapping Executions:** The primary risk is a new alarm firing while a long OCR pass is still in progress (despite the 5-minute interval). A simple boolean lock or state check must prevent concurrent `runPass()` executions.

## Exit Criteria
- After a successful pass, an alarm is created.
- When the alarm fires, `runPass()` is executed.
- Overlapping executions are prevented.
- Gate suite passes: typecheck, lint, tests, dependency-cruiser, build.
