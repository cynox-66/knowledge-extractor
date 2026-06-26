# Roadmap

## Alpha (current)

Alpha validates the crawler against real Instagram Saved collections. No Beta
features begin until every Alpha exit criterion is met.

### Completed

- [x] Monorepo infrastructure (pnpm, Turborepo, TypeScript, ESLint, Prettier, Husky, CI)
- [x] Domain contracts (`IResource`, `IMedia`, `IContentBlock`, `ISource`, `IAuthor`)
- [x] Connector contracts (`IConnector`, `IExtractionStrategy`, `IStrategyResult`, `IResourceFingerprint`)
- [x] Storage abstraction (`IStorageEngine`, `ITransaction`, `InMemoryStorage`)
- [x] Instagram connector: three-strategy chain, parser, normalizer, discovery engine, fingerprinter
- [x] Chrome MV3 extension: background worker, content script (DOM adapter), navigator, popup
- [x] CrawlController orchestration with MV3-safe `setTimeout` + `chrome.alarms` watchdog
- [x] Scheduler with queue persistence, retry, exponential backoff
- [x] Session persistence (single source of truth via `SessionManager` + `MetricsCollector`)
- [x] Automatic infinite scroll with end-of-feed termination
- [x] Full diagnostics wiring (`DiagnosticsCollector`: failure category, DOM snapshot, strategy usage)
- [x] Full metrics wiring (`MetricsCollector`: all stage/failure counters, averages, peak queue)
- [x] Stateless popup dashboard with live metrics, event stream, Export Diagnostics
- [x] Repository stabilization (all CI gates green, single extraction path, no `any` holes)
- [x] Architecture freeze + RFC-0001

### Remaining

- [ ] **Alpha Validation**: live crawl against ≥100 saved posts, populate [Alpha Report](docs/verification/alpha-report.md)
- [ ] Fix bugs discovered during validation
- [ ] Discovery performance (debounce MutationObserver, scope to added subtrees — RFC-0001 A4)
- [ ] Scheduler/controller/dedup unit tests (RFC-0001 P1)

### Exit criteria

See [RFC-0001 §9](docs/rfc/RFC-0001.md) for the full list. Key metrics:
≥95% crawl success rate, session recovery after SW restart, end-of-feed
termination, populated diagnostics export, all CI gates green.

---

## Beta (post-Alpha)

Beta adds durability, additional extraction quality, and the first export targets.

- [ ] Durable storage (IndexedDB via `IStorageEngine`)
- [ ] OCR pipeline (`IOcrEngine` + media hydration stage)
- [ ] Markdown exporter (`IExporter`)
- [ ] Obsidian exporter
- [ ] Typed event/message bus end-to-end (RFC-0001 P2)
- [ ] Carousel lazy-slide extraction (FM-004)
- [ ] Reel video URI extraction (FM-005)
- [ ] Additional connector: Reddit or LinkedIn
- [ ] Automated unit test coverage for shared/extension packages

---

## v1

v1 is a stable, multi-connector knowledge extraction platform.

- [ ] AI enrichment pipeline (`ResourceState.ENRICHED`)
- [ ] Semantic search (embeddings + vector index)
- [ ] Notion export
- [ ] PDF connector
- [ ] YouTube connector
- [ ] Generic web connector
- [ ] Desktop app (Electron or Tauri)
