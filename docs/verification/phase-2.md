# Phase 2 Walkthrough — Crawler Correctness & Observability (A2 + A3)

> Status: implemented; gates green. Runtime validation is Phase 3 (manual, live).
> Starting point: the Phase 1 checkpoint (`refactor(alpha): complete repository
stabilization and extraction unification`). Architecture remained frozen — no
> new packages, no new abstractions, no redesign.

## What changed, end to end

A crawl now runs as an MV3-safe, fully observed loop whose entire state is
persisted to `chrome.storage.session`:

```
Popup START
  → CrawlController.startCrawl()
      → SessionManager.startNewSession()   (resets canonical MetricsCollector)
      → DiagnosticsCollector.reset(pageUrl)
      → chrome.alarms watchdog created (1-min heartbeat)
      → content RUN_PIPELINE  → DiscoveryEngine starts (MutationObserver)
      → processing loop kicked (self-scheduling setTimeout chain)

Discovery batch → RESOURCES_DISCOVERED
  → CrawlController.handleDiscoveryBatch()
      → Scheduler.enqueue()  (dedup) → metrics.recordDiscovered/recordQueued
      → persist scheduler + session

Processing tick (while running, not paused):
  Scheduler.getNextTask()
    ├── task present:
    │     NAVIGATE_OPEN   → metrics.recordNavigation(latency)
    │     EXTRACT_RESOURCE→ metrics.recordExtracted(dur); diagnostics.recordStrategyUsed
    │     NAVIGATE_CLOSE
    │     connector.normalize → metrics.recordNormalized(dur)
    │     storage.saveResource → metrics.recordPersisted
    │     on any failure → metrics.record*Failure + Scheduler retry/backoff
    │                       + diagnostics.recordFailure(category, snapshot, msg)
    └── queue drained:
          NAVIGATE_SCROLL
            ├── success → new content discovered → loop continues
            └── no new height OR repeated empty scrolls → finishCrawl(end-of-feed)
```

## 1. MV3-safe orchestration

- The perpetual `setInterval` loop is gone. Processing is a **self-scheduling
  `setTimeout` chain** (`tick()` → `processNext()` → re-`scheduleTick()`) that
  only runs while the session is `isRunning && !isPaused`.
- A **`chrome.alarms` watchdog** (`ke-crawl-tick`, 1-minute period) is the
  recovery mechanism: when Chrome suspends the worker and the `setTimeout` is
  lost, the next alarm fires `resumeFromAlarm()`, which re-kicks the loop from
  persisted state.
- `CrawlController.init()` runs at **every worker startup**: it rehydrates the
  session and queue and, if a crawl was active, resumes automatically.
- Listeners (`chrome.alarms.onAlarm`, `chrome.runtime.onMessage`) are registered
  synchronously at the top of `background/index.ts` so the revived worker can
  receive events.
- New manifest permissions: `alarms`, `storage`.

## 2. Scheduler persistence

- `Scheduler.snapshot()` / `restore()` serialize the full `ICrawlTask[]` to
  `chrome.storage.session` (key `crawl_scheduler`). `ICrawlTask` is plain data,
  so attempts, `nextRetryAt` (backoff), priorities, and `lastError` all survive.
- The controller persists the queue after **every** transition (enqueue,
  complete, fail, drain).
- On restore, any task left mid-flight (`OPENING`/`EXTRACTING`) when the worker
  died is reset to `QUEUED` — so interrupted work is retried, never lost, and the
  per-URI dedup in `enqueue()` prevents duplicate work.

## 3. Session persistence (single source of truth)

- `ICrawlSession` was restructured: execution status (`isRunning`, `isPaused`,
  `isCancelled`, `currentResource`, `navigationStatus`, `queueDepth`) **plus a
  single embedded `metrics: IExtractionMetrics` snapshot**. The old duplicated
  flat counters are gone.
- `SessionManager` now **consumes `MetricsCollector`**: every `persist()` embeds
  the freshest metrics snapshot and broadcasts `SESSION_UPDATED`.
- On restart, `SessionManager.init()` rehydrates `MetricsCollector` from the
  persisted snapshot so counters continue rather than reset.

## 4. Infinite scroll

- Wired into the loop via `handleQueueDrained()`. When the queue empties and no
  task is mid-flight, the controller sends `NAVIGATE_SCROLL` to the Navigator.
- `Navigator.scrollGrid()` returning `success: false` (scroll height unchanged)
  is treated as **end-of-feed** → `finishCrawl('end-of-feed')`.
- A safety counter (`MAX_EMPTY_SCROLLS = 3`) terminates the crawl when repeated
  successful scrolls yield no new unique resources (`feed-exhausted`), guaranteeing
  termination.

## 5. Retry policy

- Lives in `Scheduler.markFailed()` (unchanged core): increments `attempts`,
  records `lastError`, and either re-queues with exponential backoff
  (`baseBackoffMs * 2^(attempts-1)`, via `nextRetryAt`) or moves to `FAILED` at
  `maxAttempts`.
- The controller now records the outcome: `metrics.recordRetry()` for a scheduled
  retry, `metrics.recordFailurePermanent()` for exhaustion, plus a stage-specific
  failure counter.

## 6. Diagnostics wiring

- `DiagnosticsCollector.reset(pageUrl)` at crawl start.
- Every failure calls `recordFailure(targetUri, category, message, { errorDetail,
domSnapshot, failingStrategy })`. Category is derived from the pipeline stage:
  navigation → `selector_failure`, extraction → `parsing_failure`, normalization
  → `normalization_failure`. The DOM snapshot is forwarded from the content
  script's failure response.
- Every successful extraction calls `recordStrategyUsed(strategyName)`. The
  winning strategy name is surfaced by `StrategyChain.execute()` (now returns
  `{ data, strategyName }`) → `connector.extract()` → content `EXTRACT_RESOURCE`
  response.
- `EXPORT_DIAGNOSTICS` → `controller.exportDiagnostics()` →
  `DiagnosticsCollector.buildReport(metrics.snapshot())`, returning a populated
  `ISessionReport`.

## 7. Metrics wiring

- `MetricsCollector` is the canonical runtime source, expanded to the full Phase 2
  set: discovered, queued, extracted, normalized, persisted, duplicates, skipped,
  failed, retries, navigation/extraction/normalization failures, timing totals,
  derived averages, crawl duration, and peak queue size.
- It is driven exclusively from `CrawlController` transitions; `SessionManager`
  embeds its snapshot rather than maintaining counters.

## 8. Popup dashboard (stateless)

- Hydrates from `GET_SESSION` on open; live-updates from `SESSION_UPDATED` and the
  `SYSTEM_STATUS` event stream.
- Renders canonical metrics (discovered, queue depth, extracted, persisted,
  duplicates, retries, failed), averages, peak queue, current resource, stage, and
  crawl status. Controls: Start / Pause / Resume / Cancel / **Export Diagnostics**
  (downloads the `ISessionReport` JSON).
- Closing the popup never stops the crawl (execution is entirely in the worker);
  reopening instantly restores state from the persisted session.

## Files modified

Types (`packages/types`): `connector/metrics.ts` (expanded `IExtractionMetrics`),
`connector/session.ts` (restructured `ICrawlSession`).

Shared (`packages/shared`): `metrics-collector.ts` (canonical, expanded, hydrate).

Connector (`connectors/instagram`): `strategy-chain.ts` (returns winning strategy),
`index.ts` (`extract()` surfaces strategy name).

Extension (`apps/extension`): `background/crawl-controller.ts` (rewritten),
`background/session-manager.ts` (rewritten), `background/scheduler.ts`
(snapshot/restore/queue depth), `background/index.ts` (alarm listener, typed
accessors), `content/index.ts` (passes strategy name), `popup/index.tsx`
(rewritten dashboard), `manifest.json` (`alarms`, `storage`).

## How to validate (Phase 3)

Build `apps/extension`, load `dist/` unpacked, open `instagram.com/saved`, click
**Start**, and verify against `docs/verification/alpha-report.md`. Specifically
exercise: close/reopen the popup mid-crawl; reload/terminate the service worker
from `chrome://extensions` and confirm the crawl resumes with the queue intact;
let the feed run to the end and confirm clean termination; export diagnostics and
confirm metrics + failures are populated and match observed behavior.

## Known limitations (carried into Phase 3 / Beta)

- **No automated tests for Scheduler/MetricsCollector yet.** These are pure and
  unit-testable; adding a test runner to `apps/extension`/`packages/shared` is
  RFC-0001 P1 (before Beta). Phase 2 keeps the existing connector suite green.
- **`navigations` sample count is not persisted separately**; after a worker
  restart it is reconstructed as a lower bound (= extracted) so navigation-latency
  averages remain meaningful but may be slightly biased post-restart.
- **Carousel lazy-slide and reel-buffering hypotheses** (FM-004/FM-005 in the
  Alpha report) are unaddressed by design — they are extraction-quality issues to
  confirm with live evidence, not crawler-loop concerns.
- **Discovery scan cost** (full-document re-scan in `DiscoveryEngine`) is
  unchanged here; it is RFC-0001 Sprint A4 and tracked separately.
- The typed event/message bus migration (raw `SYSTEM_STATUS` strings) remains
  RFC-0001 P2; the message contract is unchanged in Phase 2.
