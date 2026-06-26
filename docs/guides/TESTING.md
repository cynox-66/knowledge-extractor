# Testing

## Fixture-based connector tests

The primary test surface is fixture-based regression testing for connectors.

### How it works

1. Capture a real DOM snapshot from the source (e.g., an Instagram `<article>`).
2. Save it as `tests/fixtures/<name>.html`.
3. Create the expected `IResource` output as `tests/fixtures/<name>.expected.json`.
4. Write a test that loads the fixture, runs the strategy/connector, and asserts
   the output matches.

### Running tests

```bash
pnpm run test              # all packages (via Turborepo)
cd connectors/instagram && pnpm run test        # single package
cd connectors/instagram && pnpm run test:watch  # watch mode
```

### Current fixtures

| Fixture                  | Layout              | Tests                               |
| ------------------------ | ------------------- | ----------------------------------- |
| `single-image-post.html` | Single image        | Strategy, normalization             |
| `carousel-post.html`     | Carousel (3 slides) | Strategy, normalization, children   |
| `reel-post.html`         | Reel (video)        | Strategy, normalization, media type |

### Adding a regression fixture

When a production bug is discovered during Alpha validation:

1. Export the DOM snapshot from the diagnostics report (`IFailureRecord.domSnapshot`)
   or capture it manually.
2. Save as `tests/fixtures/<descriptive-name>.html`.
3. Determine the correct expected output and save as `<name>.expected.json`.
4. Write a test that reproduces the failure with the old code, then passes with
   the fix.

## Alpha validation (manual)

Alpha validation is a live run against a real Instagram Saved collection. It is
not automated — it requires a logged-in browser session.

### Procedure

1. Build and load the extension (see [DEVELOPMENT.md](DEVELOPMENT.md)).
2. Navigate to `instagram.com/saved`.
3. Click **Start** in the popup.
4. Let the crawler run to completion (auto-terminates at end-of-feed).
5. Click **Export Diagnostics** to download the `ISessionReport`.
6. Fill in the [Alpha Report](../verification/alpha-report.md) with measured values.

### What to verify

- Discovery finds items beyond the initial viewport (scroll works).
- Extraction succeeds on single-image, carousel, and reel posts.
- Retry policy recovers transient failures.
- Closing and reopening the popup does not interrupt the crawl.
- Terminating the service worker (via `chrome://extensions`) and reopening the
  tab resumes the crawl with the queue intact.
- Diagnostics export contains non-zero metrics and, if failures occurred,
  populated `IFailureRecord` entries.

### Interpreting diagnostics

The exported `ISessionReport` contains:

| Field                            | What it tells you                                        |
| -------------------------------- | -------------------------------------------------------- |
| `metrics.discovered / persisted` | Overall success rate                                     |
| `metrics.failed`                 | Permanent failures (exhausted retries)                   |
| `metrics.retries`                | Transient failures that were retried                     |
| `metrics.avgExtractionTime`      | Per-resource extraction cost                             |
| `metrics.peakQueueSize`          | Maximum Scheduler depth                                  |
| `strategyUsage`                  | Which strategies won (semantic > data-attr > heuristic)  |
| `failures[]`                     | Per-failure: category, targetUri, rootCause, domSnapshot |

## Test coverage gaps (known)

The following are not yet covered by automated tests (RFC-0001 P1, before Beta):

- `Scheduler` retry/backoff logic
- `CrawlController` lifecycle (start/pause/resume/cancel)
- `SessionManager` persistence and rehydration
- `MetricsCollector` accumulation and `hydrate()`
- `DiscoveryEngine` dedup and MutationObserver behavior
- `Navigator` modal open/close/scroll

These are all pure or mockable and should be unit-tested before Beta.
