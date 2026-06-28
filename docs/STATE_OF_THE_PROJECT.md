# State of the Project

> Internal architecture handoff. Written to be read cold by a Staff Engineer six
> months from now. Optimized for engineering correctness, not encouragement.
> Date of writing: end of Alpha (first real telemetry + four research reports).

## What exists

- A Chrome MV3 extension that crawls Instagram Saved posts end-to-end:
  discovery (MutationObserver) → scheduler queue → navigation → extraction
  (three-strategy chain) → normalization to `IResource` → in-memory persistence
  → metrics + diagnostics → stateless popup.
- MV3-safe orchestration: self-scheduling loop + `chrome.alarms` watchdog,
  queue/session persisted to `chrome.storage.session`, resumes after worker
  eviction.
- Full observability: canonical `MetricsCollector`, `DiagnosticsCollector` with
  per-failure category + DOM snapshot, exportable `ISessionReport`.
- Clean repo: 3 real packages (`types`, `shared`, `storage`) + 1 connector
  (`instagram`) + 1 app (`extension`). All six CI gates green (build, typecheck,
  lint, test, depcruise, format). Documentation regenerated from implementation.

## What has been proven

- The crawler architecture works against the real, hostile Instagram DOM. It is
  no longer the primary engineering risk.
- The MV3 lifecycle is survivable: persistence + alarm recovery hold up.
- The ingestion/enrichment seam in the domain model is real: `IResource` already
  carries `ResourceState` (DISCOVERED→EXTRACTED→HYDRATED→ENRICHED→…),
  `IMedia.localUri`, `IResourceCompleteness.ocr`, and `IOcrEngine` exists. The
  back half of the pipeline was designed in; it just isn't built.
- The connector isolation principle survives contact with a second mental model
  (enrichment): platform logic is in the connector, everything downstream is
  source-agnostic.

## What assumptions were invalidated

1. **"The captured metadata is the value."** False for the target use case.
   Telemetry + the knowledge-extraction research confirm: for educational reels
   and carousels, the knowledge is in the pixels (slides, diagrams, code, terminal
   output), not the caption. Capture without OCR is just indexing Instagram.
2. **"Extraction is the weak subsystem."** False. Navigation is weaker, and the
   navigation failures are really _target-classification_ failures (reels,
   comment pages, `liked_by` pages enqueued as if they were posts).
3. **"OCR is a future enhancement."** False. It is the core product subsystem.
   Without it there is no defensible wedge.
4. **"InMemoryStorage is fine for Alpha."** True for Alpha, fatal for Beta. A
   deferred enrichment pipeline is impossible on volatile storage. This is now
   the gate.
5. **"IndexedDB is durable."** Only conditionally. Browser storage is evictable
   under pressure unless `navigator.storage.persist()` is granted. Durable means
   IndexedDB + OPFS + persisted-storage request + an export path — not IndexedDB
   alone.

## What architecture is now considered stable (do not rewrite)

These are frozen. Changing any requires a superseding RFC:

- The normalized domain model: `IResource`, `IMedia`, `IContentBlock`, `ISource`,
  `IAuthor`, `ResourceState`. It already anticipates enrichment. Extend it with an
  additive enrichment/annotation layer; do not mutate the core or jam a graph into it.
- Execution vs. domain state separation (`ICrawlTask`/`TaskState` vs.
  `IResourceCompleteness`).
- Layer boundaries + dependency direction (dependency-cruiser enforced).
- Connector isolation; `IConnector<TRaw>` contract.
- `CrawlController` (orchestration), `Scheduler` (queue/retry), `Navigator`
  (browser manipulation) ownership.
- `IStorageEngine` / `ITransaction` — designed precisely for the swap to a durable
  backend. Do not redesign it; implement it.
- Popup as monitoring-only.

## What remains experimental (and what to NOT start)

- Everything in the enrichment half is unbuilt: media capture, durable storage,
  OCR, search, embeddings, knowledge extraction.
- **Do not start** (research-report temptations that are scope poison at this
  stage): knowledge graphs / GraphRAG, biologically-inspired memory (decay,
  consolidation, "sleep cycles"), temporally-aware bi-temporal graphs, ambient
  HCI / promptless retrieval, smart-glasses ingestion, multiplayer agentic graphs,
  a plugin SDK, a backend, a vector database service. None of these survive a
  cost/value test against a product that cannot yet OCR a saved carousel.
- **Defer (needs a backend or desktop host, decide later):** Whisper STT for reel
  audio, vision-LLM analysis of infographics, cloud OCR, multi-device sync.

## Two seeds worth keeping from the vision research

Quarantined from the roadmap but worth remembering when v1 design starts:

1. **Bi-temporal validity** (a fact's `valid_from`/`valid_to`). If/when a
   relationship/knowledge-graph layer is built, model edges with validity
   intervals rather than destructive overwrites. Cheap to honor in schema design;
   do not build the graph now.
2. **GraphRAG > flat vectors for multi-hop reasoning.** When semantic retrieval is
   built, plan for hybrid (keyword + vector + structure), not pure cosine
   similarity. Influences the v1 search design, not Beta.

## What the team should focus on next

In strict dependency order. Do not start N+1 before N is green:

1. **Durable local substrate** (THE milestone): implement `IStorageEngine` over
   IndexedDB (structured data) + OPFS (media blobs), request
   `navigator.storage.persist()`, add schema versioning and a JSON/Markdown export.
   Replaces `InMemoryStorage`. Unblocks everything.
2. **Media capture in-crawl**: download image bytes during the authenticated
   session (CDN URLs are ephemeral — they cannot be fetched later) → `HYDRATED`.
3. **Offscreen-document OCR** (Tesseract.js) as the first `IEnrichmentStage` →
   `ENRICHED`; OCR text into `content[]`. No backend required.
4. **Keyword search** (SQLite FTS5 or FlexSearch) over `content[]`.
5. **Export** (Markdown/Obsidian/JSON) — pull this early; it is table-stakes and
   the answer to "why won't users get stranded."

In parallel (no dependency, finish Alpha): fix navigation target-classification;
add Scheduler/SessionManager/Metrics unit tests; populate the Alpha report.

## The one-sentence honest summary

The hard, defensible engine (durable local store → media capture → OCR → search →
export) is mostly unbuilt and is entirely achievable with no backend; the grand
"cognitive engine" vision is a distraction until that engine exists and produces
search results a user would pay for.
