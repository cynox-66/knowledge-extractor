# Runtime Pipeline

The crawl pipeline runs as a loop inside the CrawlController. Each stage has a
single owner; no stage crosses its responsibility boundary.

## Pipeline stages

```
Discovery (DiscoveryEngine — content script)
    │ MutationObserver scans DOM for <article> and /p/ /reel/ links
    │ Fingerprints each resource; deduplicates against a Set<hash>
    │ Batches discovered resources → RESOURCES_DISCOVERED message
    ↓
Queue (CrawlController.handleDiscoveryBatch — background)
    │ Scheduler.enqueue() — dedup by targetUri
    │ MetricsCollector.recordDiscovered/recordQueued
    │ Persists queue snapshot to chrome.storage.session
    ↓
Scheduler (Scheduler.getNextTask — background)
    │ Returns highest-priority QUEUED task with nextRetryAt ≤ now
    │ Transitions task to OPENING
    ↓
Navigator (Navigator.openResource — content script)
    │ Clicks the grid thumbnail → waits for modal article[role=presentation]
    │ Falls back to scrolling the in-feed article into view
    │ Returns openLatencyMs, domStabilizeMs
    ↓
Extractor (InstagramConnector.extract — content script)
    │ Content script locates the <article>, calls connector.extract()
    │ StrategyChain tries Semantic → DataAttribute → StructuralHeuristic
    │ Returns IInstagramParsedPost + strategyName
    ↓
Normalizer (InstagramConnector.normalize — background)
    │ InstagramParser.enrich → InstagramNormalizer.normalize
    │ Maps raw post to IResource (domain model, ResourceState.EXTRACTED)
    ↓
Capture (MediaCaptureCoordinator — background, content script for bytes)
    │ Asks content script to fetch each IMedia.sourceUri with the
    │   authenticated session (CAPTURE_MEDIA)
    │ Persists bytes via IMediaStore (OPFS); stamps localUri on each item
    │ Hydrates carousel children recursively
    │ Promotes ResourceState → HYDRATED iff every present media item landed
    │ Total failure → throws and routes to handleTaskFailure (retry)
    ↓
Persistence (IStorageEngine.saveResource — background)
    │ Saves the (possibly HYDRATED) IResource inside a buffered transaction
    │ MetricsCollector.recordPersisted
    ↓
Metrics (MetricsCollector — background)
    │ Records per-stage counters, timing, failures, averages
    │ Embedded into ICrawlSession on every SessionManager.persist()
    ↓
Diagnostics (DiagnosticsCollector — background)
    │ On failure: recordFailure(category, targetUri, message, domSnapshot)
    │ On success: recordStrategyUsed(strategyName)
    │ buildReport(metrics) → ISessionReport (exportable JSON)
    ↓
Popup (stateless dashboard — popup context)
    │ Hydrates from GET_SESSION; live-updates from SESSION_UPDATED
    │ Renders canonical metrics; Export Diagnostics downloads ISessionReport
```

## Stage ownership

| Stage         | Owner                          | Context                      | File                                                                                     |
| ------------- | ------------------------------ | ---------------------------- | ---------------------------------------------------------------------------------------- |
| Discovery     | `DiscoveryEngine`              | Content script               | `connectors/instagram/src/discovery-engine.ts`                                           |
| Queue         | `CrawlController`              | Background                   | `apps/extension/src/background/crawl-controller.ts`                                      |
| Scheduling    | `Scheduler`                    | Background                   | `apps/extension/src/background/scheduler.ts`                                             |
| Navigation    | `Navigator`                    | Content script               | `apps/extension/src/content/navigator.ts`                                                |
| Extraction    | `InstagramConnector.extract`   | Content script               | `connectors/instagram/src/index.ts`                                                      |
| Normalization | `InstagramConnector.normalize` | Background                   | `connectors/instagram/src/index.ts`                                                      |
| Capture       | `MediaCaptureCoordinator`      | Background + content (fetch) | `apps/extension/src/background/media-capture.ts` + `apps/extension/src/content/index.ts` |
| Persistence   | `IndexedDbStorageEngine`       | Background                   | `packages/storage/src/indexeddb/indexeddb-storage.ts`                                    |
| Metrics       | `MetricsCollector`             | Background                   | `packages/shared/src/metrics-collector.ts`                                               |
| Diagnostics   | `DiagnosticsCollector`         | Background                   | `packages/shared/src/diagnostics-collector.ts`                                           |
| Monitoring    | Popup                          | Popup                        | `apps/extension/src/popup/index.tsx`                                                     |

## Infinite scroll

When the Scheduler queue drains and no task is mid-flight, the controller sends
`NAVIGATE_SCROLL` to the Navigator. New content arrives via
`RESOURCES_DISCOVERED`. The loop terminates cleanly when:

- `Navigator.scrollGrid()` reports no new scroll height (end-of-feed), or
- Repeated scrolls yield no new unique resources (feed-exhausted, after
  `MAX_EMPTY_SCROLLS = 3`).

## Retry policy

Owned by the Scheduler. On failure, `markFailed()` increments `attempts` and
either re-queues with exponential backoff (`nextRetryAt = now + baseBackoffMs *
2^(attempts-1)`) or moves to `TaskState.FAILED` at `maxAttempts` (default 3).
The controller records `metrics.recordRetry()` or
`metrics.recordFailurePermanent()` accordingly.

## Failure categorization

Derived from the pipeline stage where the error occurred:

| Stage         | `FailureCategory`       |
| ------------- | ----------------------- |
| Navigation    | `selector_failure`      |
| Extraction    | `parsing_failure`       |
| Capture       | `network_error`         |
| Normalization | `normalization_failure` |

Every failure is recorded to `DiagnosticsCollector` with `targetUri`, `category`,
`rootCause`, optional `domSnapshot`, and `failingStrategy`.
