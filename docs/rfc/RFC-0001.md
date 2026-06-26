# RFC-0001 — Alpha Stabilization Execution Plan

| Field           | Value                                                          |
| --------------- | -------------------------------------------------------------- |
| Status          | Proposed                                                       |
| Author          | Engineering (Staff review follow-up)                           |
| Date            | 2026-06-26                                                     |
| Supersedes      | —                                                              |
| Source of truth | Staff Engineering Audit (2026-06-26)                           |
| Scope           | All work required to reach a stable, Alpha-ready crawler       |
| Constraint      | This RFC plans work only. No code is changed by this document. |

> Finding IDs (`A1`, `D1`, `X1`, `B2`, …) reference the Staff Engineering Audit and are used throughout for traceability.

---

## 1. Executive Summary

**Architecture maturity: High (design) / Medium (runtime).**
The contract layer (`packages/types`) is well-modeled, single, normalized, and platform-agnostic. Layer boundaries are enforced mechanically by dependency-cruiser (0 violations across 84 modules). The intended pipeline — Discovery → Queue → Scheduler → Navigator → Extractor → Normalizer → Persistence → Diagnostics — exists as named, separated units.

**Implementation maturity: Low–Medium.**
The runtime wiring diverges from the design in four material ways: (1) extraction is duplicated into the content script while the connector's tested extraction path is dead, (2) diagnostics and metrics collectors are instantiated but never driven from the execution path, (3) infinite scroll exists but is not wired into the crawl loop, and (4) the orchestration loop uses MV3-hostile primitives (`setInterval`) with a non-persistent in-memory queue.

**Repository health: Not clean.**
CI is red today at Format Check. `turbo run lint` executes zero tasks (no package defines a `lint` script). `turbo run typecheck` covers 1 of 10 packages. The working tree carries macOS duplicate-file artifacts (`* 2.ts`, `tsconfig 2.json`, …), some git-tracked. Tests cover one strategy and the parser/normalizer happy path only.

**Alpha readiness: Not ready.**
Alpha's mandate is _"do not estimate — measure."_ As wired today, a crawl would produce zeroed metrics and empty failure reports, discovery would be capped at first render (no scroll), and the build does not pass cleanly. **Alpha cannot produce valid engineering evidence until the observability path and crawl loop are connected and the build is restored.**

**Overall health score (from audit): 5.2 / 10.** Strong skeleton; execution wiring and build hygiene are the gap.

---

## 2. Architecture Status

### 2.1 Architecture Correct — **FREEZE**

These are correct, validated, and must not change without a superseding RFC.

| Area                                        | Evidence                                                                                  | Why frozen                                                                                                                   |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Normalized domain model                     | `IResource`, `IMedia`, `IContentBlock`, `ISource`, `IAuthor` in `packages/types/src/core` | Single, platform-agnostic aggregate; supports children, completeness, lifecycle states.                                      |
| Execution vs. domain split                  | `ICrawlTask`/`TaskState` (execution) vs. `IResourceCompleteness` (domain)                 | Clean separation; scheduler owns execution, resource owns completeness.                                                      |
| Package boundaries / dependency direction   | dependency-cruiser: 0 violations, 84 modules                                              | Layer 0 (`types`) imports nothing; Layer 1 (`shared`, `utils`) imports only Layer 0; connectors isolated; no `apps` imports. |
| Scheduler ownership of the queue            | `Scheduler` owns `Map<string, ICrawlTask>`, retry/backoff                                 | Queue, priority, retry live in one owner; connector has no scheduling role.                                                  |
| Storage abstraction                         | `IStorageEngine`/`ITransaction`; `InMemoryStorage` implements it                          | Engine is isolated from persistence implementation.                                                                          |
| Connector isolation                         | `connectors/instagram/src/*`; depcruise rule `connectors-cannot-import-connectors`        | Connectors discover/extract/normalize only.                                                                                  |
| Strategy-chain extraction pattern           | `IExtractionStrategy`, `IStrategyResult`, `StrategyChain`                                 | Ordered, confidence-scored, non-throwing strategy fallback.                                                                  |
| Navigator ownership of browser manipulation | `apps/extension/src/content/navigator.ts`                                                 | Scrolling/modal/wait isolated from extraction.                                                                               |

### 2.2 Architecture Drift — **CORRECT DURING STABILIZATION**

| Drift                                                                                                                                                                                                  | Audit ID | Why it happened                                                                                                                                              | Impact                                                                                                                                                                          | Recommended correction                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Duplicated extraction** — `extractSingleResource()` in `content/index.ts` re-implements `SemanticArticleStrategy`; the connector's `extractArticle`→chain→parser→normalizer path is dead at runtime. | A1, A2   | Vertical-slice expediency: the content script needed _something_ extracting before the connector chain was complete, and the two were never reconciled.      | Runtime quality is governed by an untested inline copy; the tested chain (incl. fallback strategies) provides false confidence; adding a connector means editing the extension. | Route content-script extraction through the connector's `extractArticle`/StrategyChain. Delete the inline copy. (Sprint A1)               |
| **Diagnostics not wired** — `DiagnosticsCollector` is injected but `recordFailure`/`recordStrategyUsed`/`reset` are never called.                                                                      | X1, X3   | Collector built before the controller's failure path existed; never connected.                                                                               | `EXPORT_DIAGNOSTICS` returns empty failures and empty strategy usage — Alpha measurement surface is blank.                                                                      | Drive the collector from `CrawlController` failure/strategy paths; forward content-script DOM snapshots into `recordFailure`. (Sprint A3) |
| **Metrics not wired** — background `MetricsCollector` never receives `recordExtracted/recordFailed/addExtractionTime`; only `SessionManager` counters move.                                            | X2       | Two collectors in two contexts (content + background) that were never reconciled.                                                                            | `metrics.snapshot()` feeding the diagnostics report is all-zeros.                                                                                                               | Single source of truth for metrics in the background; drive from controller transitions. (Sprint A3)                                      |
| **Connector contract bypass / duplicate `IConnector`** — two conflicting `IConnector` interfaces re-exported from one barrel; `InstagramConnector` implements neither.                                 | D2       | Contract evolved twice (pipeline-style `normalize` vs. capability-style `extract`) without reconciliation; `export *` silently dropped the ambiguous symbol. | The canonical connector contract is unusable; nothing enforces connector shape.                                                                                                 | Collapse to one `IConnector`; make `InstagramConnector` implement it. (Sprint A1)                                                         |
| **Runtime ownership violation (Content Script owns parsing)**                                                                                                                                          | A2       | Same root as A1.                                                                                                                                             | Content Script exceeds "DOM access only"; Extractor stage has no real home.                                                                                                     | Promote Extractor to a real stage owned by the connector; content script supplies DOM only. (Sprint A1)                                   |
| **Crawl loop uses MV3-hostile primitives** — `setInterval(1000)`; in-memory `Scheduler.tasks` not persisted.                                                                                           | §6       | Authored as if a long-lived background page (MV2 mental model) rather than an evictable MV3 service worker.                                                  | SW eviction kills the loop and drops the queue mid-crawl; "session restores correctly" fails.                                                                                   | `chrome.alarms`-driven loop; persist queue snapshot to `chrome.storage.session`. (Sprint A2)                                              |
| **Infinite scroll not wired** — `Navigator.scrollGrid()` exists; controller comments "trigger scroll … later."                                                                                         | §6       | Scroll built as a capability before the controller's idle-handling existed.                                                                                  | Discovery is capped at first render; large Saved collections under-discovered.                                                                                                  | Controller drives scroll on queue-drain until end-of-grid. (Sprint A2)                                                                    |
| **Platform leak into Layer 0** — `IInstagramParsedPost`/`InstagramPostLayout` defined in `packages/types`.                                                                                             | D1       | Convenience: the parser's intermediate type was placed next to other connector contracts.                                                                    | Engine "knows" about Instagram; violates single-normalized-domain rule; pollutes the frozen layer.                                                                              | Move Instagram-specific intermediate types into `connectors/instagram`. (Sprint A1, low-risk)                                             |
| **Typed event/message bus bypassed** — raw string actions not in `EventAction`/`MessageAction`.                                                                                                        | A3       | Events emitted ad hoc as the controller grew.                                                                                                                | No compile-time safety on the bus; drift between producers/consumers.                                                                                                           | Route all messages through the typed unions. (Sprint A2/P2)                                                                               |

---

## 3. Stabilization Sprints

Each sprint is independently completable and has explicit exit criteria. Sprints are ordered by dependency, not by importance alone.

### Sprint A0 — Repository Stabilization

**Goals:** Restore a clean, trustworthy build so every later sprint is measured against a stable baseline.
**Deliverables:**

1. Remove all macOS duplicate artifacts (`* 2.*`, `* 3.*`) from the tree and git index (B1).
2. Remove leftover codemod scripts `fix-exports.js`, `fix-all-imports.js` (B5).
3. Add a `typecheck` script (`tsc --noEmit`) to every package: `types`, `shared`, `storage`, `utils`, `extractor`, `ocr`, `ai`, `exporters`, `extension` (B2).
4. Add a real `lint` script per package (or convert root `lint` to run `eslint .` across the workspace) so `turbo run lint` is non-vacuous; fix the 17 eslint errors / 4 warnings, including stub files not covered by any tsconfig (B3).
5. Make `format:check` pass (B4).
6. Decide and document the fate of the 5 empty stub packages and the empty legacy connector dirs (`extractors/`, `models/`, `selectors/`, `pipeline/`): either delete or mark as intentional placeholders excluded from lint/typecheck (graph hygiene).
7. (Optional, low-risk) Either make project references functional (`composite: true` on leaf configs) or remove the references to avoid implying a `tsc -b` workflow that doesn't work (B6).
   **Exit Criteria (all objectively verifiable):**

- `find . -name "* [0-9]*" -not -path '*/node_modules/*'` returns zero results.
- `pnpm run typecheck` runs for **10/10** packages and exits 0.
- `pnpm run lint` executes a non-zero task count and exits 0; `eslint .` exits 0.
- `pnpm run format:check` exits 0.
- `pnpm run depcruise` exits 0.
- `pnpm run test` exits 0; `pnpm run build` exits 0.
  **Dependencies:** None. **This is the root of the graph.**
  **Estimated complexity:** Low (mechanical). **Risk:** Low — but must be done first and committed to freeze the tree (a watcher/editor was observed rewriting files mid-audit).

### Sprint A1 — Runtime Correctness (Extraction Unification)

**Goals:** Eliminate the duplicated extraction path; restore the connector as the single extraction owner; clean the domain leak and duplicate contract.
**Deliverables:**

1. Content script supplies the DOM element only; extraction routes through `InstagramConnector.extractArticle` → `StrategyChain` → `InstagramParser` → `InstagramNormalizer`.
2. Delete `extractSingleResource()`'s inline parsing logic (A1, A2).
3. Collapse the two `IConnector` interfaces into one canonical contract; `InstagramConnector` implements it (D2).
4. Move `IInstagramParsedPost`/`InstagramPostLayout` out of `packages/types` into the Instagram connector (D1).
5. Remove the `any` escape hatch in `InstagramNormalizer.normalize` (D4); return a typed `IResource`.
   **Exit Criteria:**

- No extraction/selector logic remains in `apps/extension/src/content`.
- `grep -ri "instagram" packages/types/src` returns only doc-comment examples, no type definitions.
- Exactly one `IConnector` symbol is exported from `@knowledge-extractor/types`; `InstagramConnector` implements it (typechecked).
- A test asserts the content script's produced record is consumed by the connector chain (single path).
  **Dependencies:** Requires A0 (clean build to refactor against).
  **Estimated complexity:** Medium. **Risk:** Medium — touches the live extraction path; mitigated by existing fixtures plus new single-path test.

### Sprint A2 — Crawler Correctness (Lifecycle & Scroll)

**Goals:** Make the crawl loop survive MV3 lifecycle and actually drive discovery to completion.
**Deliverables:**

1. Replace `setInterval` orchestration with a `chrome.alarms`-driven loop (§6).
2. Persist the Scheduler queue snapshot to `chrome.storage.session`; rehydrate on SW restart so pause/resume/cancel and recovery are real.
3. Wire `Navigator.scrollGrid()` into the controller: on queue drain, scroll until end-of-grid is detected, then finish.
4. Route lifecycle/pipeline messages through the typed `EventAction`/`MessageAction` unions (A3).
5. Remove the `(controller as any).sessionManager` access via a typed accessor (A4).
   **Exit Criteria:**

- Killing/restarting the service worker mid-crawl restores both session stats **and** the pending queue; the crawl continues.
- A crawl over a multi-screen grid discovers items beyond the initial viewport (scroll-driven), and terminates on end-of-grid.
- No raw string message actions remain outside the typed unions (lint/grep check).
  **Dependencies:** Requires A1 (single extraction path before persisting/queuing its inputs). Requires A0.
  **Estimated complexity:** Medium–High. **Risk:** Medium — MV3 timing is subtle; mitigated by an SW-restart integration test.

### Sprint A3 — Observability (Diagnostics & Metrics Wiring)

**Goals:** Connect the measurement surface to the execution path so Alpha can measure rather than estimate.
**Deliverables:**

1. Drive `DiagnosticsCollector` from `CrawlController`: `reset(pageUrl)` at crawl start, `recordFailure(...)` on every failure with category + DOM snapshot, `recordStrategyUsed(...)` per extraction (X1, X3).
2. Forward content-script DOM failure snapshots into `recordFailure` (X3).
3. Single background `MetricsCollector` updated on every transition: `recordExtracted/recordFailed/recordDuplicate/addExtractionTime/addNormalizationTime` (X2).
4. Ensure `EXPORT_DIAGNOSTICS` → `buildReport` returns populated `metrics`, `failures`, `strategyUsage`, and `memoryUsageMb`.
   **Exit Criteria:**

- After a crawl with at least one induced failure, `EXPORT_DIAGNOSTICS` returns: non-zero `metrics.extracted`, ≥1 `failures` entry with `category` + `domSnapshot`, and non-empty `strategyUsage`.
- `metrics.snapshot()` values match independently counted crawl outcomes (cross-checked against `SessionManager`).
  **Dependencies:** Requires A1 (strategy usage/failures only meaningful once extraction is unified) and A2 (failures arise from the real loop). Requires A0.
  **Estimated complexity:** Medium. **Risk:** Low — additive wiring, no architectural change.

### Sprint A4 — Performance (Discovery Scan)

**Goals:** Remove the discovery scaling ceiling before validating against a real collection.
**Deliverables:**

1. Debounce the `MutationObserver` callback; coalesce mutation bursts (§9).
2. Scope scans to added subtrees instead of re-scanning all of `document.body`; dedup against `seen` **before** full traversal/fingerprinting (§9).
3. Capture a memory-growth measurement during a large-collection scroll for the Alpha report.
   **Exit Criteria:**

- Discovery cost per mutation batch is bounded by added-node count, not total DOM size (verified by instrumented timing on a synthetic large grid).
- No quadratic growth in scan time as discovered count increases (timing curve recorded).
- Heap usage stays within the Alpha memory limit defined in §8 during a full scroll.
  **Dependencies:** Requires A2 (scroll must drive discovery to exercise the hot path). Independent of A3.
  **Estimated complexity:** Medium. **Risk:** Medium — observer scoping can miss nodes; mitigated by a dedup-accuracy test (§7).

### Sprint A5 — Alpha Validation

**Goals:** Execute the measured validation run against a real Instagram Saved collection and record evidence.
**Deliverables:**

1. Add regression tests closing the §7 gaps: Scheduler retry/backoff, CrawlController happy+failure paths, DiscoveryEngine dedup, SessionManager restore, fallback strategies, fingerprint collisions.
2. Execute a real crawl; export the diagnostics report.
3. Produce the Alpha Validation report measuring every metric in §8.
   **Exit Criteria:** All §8 success metrics met and recorded with real numbers (no estimates).
   **Dependencies:** Requires A0–A4 complete.
   **Estimated complexity:** Medium. **Risk:** Medium — depends on live Instagram DOM stability; mitigated by fixtures + retry policy.

---

## 4. Dependency Graph Between Fixes

```
A0 Repository Stabilization
  Requires: nothing (ROOT)
  Blocks:   A1, A2, A3, A4, A5 (everything)
  Independent of: OCR, exporters, AI

A1 Extraction Unification (A1/A2/D1/D2/D4)
  Requires: A0
  Blocks:   A2 (persist a single input shape), A3 (strategyUsage/failures), Reddit/LinkedIn/YouTube connectors
  Independent of: A4 performance, storage abstraction

A2 Crawler Lifecycle + Scroll (MV3, queue persistence, scroll wiring)
  Requires: A0, A1
  Blocks:   A3 (real failures from real loop), A4 (scroll feeds hot path), A5
  Independent of: domain model, exporters

A3 Diagnostics + Metrics Wiring (X1/X2/X3)
  Requires: A0, A1, A2
  Blocks:   A5 (Alpha cannot measure without it)
  Independent of: A4 performance, OCR

A4 Discovery Performance (MutationObserver)
  Requires: A0, A2
  Blocks:   A5 (large-collection viability)
  Independent of: A3 diagnostics, A1 contracts

A5 Alpha Validation
  Requires: A0, A1, A2, A3, A4
  Blocks:   OCR, AI enrichment, additional connectors (gated on Alpha completion)
  Independent of: nothing remaining
```

**Permanently independent of the Alpha critical path (do not start until after Alpha):** OCR, video frame extraction, AI enrichment, semantic search, Markdown/Obsidian/Notion exporters, PDF/Reddit/LinkedIn/YouTube/generic connectors.

---

## 5. Critical Path

The shortest path to **"a stable, Alpha-ready crawler"**:

```
A0  →  A1  →  A2  →  A3  →  A5
                └→  A4 ─────┘
```

**On the critical path (do this, in order):**

1. **A0** — clean build (root dependency of everything).
2. **A1** — unify extraction (single tested path; prerequisite for meaningful diagnostics).
3. **A2** — MV3 lifecycle + queue persistence + scroll wiring (a crawl must survive and progress).
4. **A3** — wire diagnostics/metrics (Alpha must measure).
5. **A4** — discovery performance (runs in parallel after A2; required for real-collection viability).
6. **A5** — validate and record.

**Deferred off the critical path:** typed event-bus migration beyond what A2 requires (P2), project-reference correctness (P2), stub-package cleanup beyond lint-passing (P3), all future features.

---

## 6. Technical Debt Register

Owner column uses roles, not names (assign at sprint planning).

### P0 — Must fix before Alpha

| ID        | Description                                           | Impact                                           | Owner     | Dependency | Effort |
| --------- | ----------------------------------------------------- | ------------------------------------------------ | --------- | ---------- | ------ |
| B1        | Remove duplicate-file artifacts (tracked + untracked) | Unstable tree; CI noise                          | Build     | none       | S      |
| B2        | `typecheck` script on all 10 packages                 | Extension/shared/storage/types never typechecked | Build     | none       | S      |
| B3        | Make `lint` real; fix 17 errors/4 warnings            | Lint gate is vacuous; quality unenforced         | Build     | none       | M      |
| B4        | Pass `format:check`                                   | CI red today                                     | Build     | none       | S      |
| X1        | Wire `DiagnosticsCollector` into controller           | Empty failure reports → Alpha measures nothing   | Runtime   | A1, A2     | M      |
| X2        | Wire background `MetricsCollector`                    | Zeroed metrics in report                         | Runtime   | A1, A2     | M      |
| X3        | Forward DOM snapshots into `recordFailure`            | No failure root-cause evidence                   | Runtime   | X1         | S      |
| A1/A2     | Unify extraction; remove content-script parsing       | Untested runtime path; false test confidence     | Runtime   | A0         | M      |
| §6-loop   | `chrome.alarms` loop + queue persistence              | SW eviction drops crawl/queue                    | Runtime   | A1         | M–L    |
| §6-scroll | Wire scroll into crawl loop                           | Discovery capped at first render                 | Runtime   | A1         | M      |
| §9        | Debounce/scope MutationObserver                       | Quadratic discovery on large collections         | Connector | A2         | M      |

### P1 — Must fix before Beta

| ID     | Description                                        | Impact                                | Owner     | Dependency | Effort |
| ------ | -------------------------------------------------- | ------------------------------------- | --------- | ---------- | ------ |
| D2     | Collapse duplicate `IConnector`; implement it      | No enforceable connector contract     | Types     | A0         | S      |
| §7     | Tests: Scheduler/retry, controller, dedup, restore | Retry (an exit criterion) is untested | QA        | A1, A2     | M–L    |
| A3-bus | Typed event/message bus end-to-end                 | Producer/consumer drift               | Runtime   | A2         | M      |
| D4     | Remove `any` in normalizer                         | Domain-type guarantee hole            | Connector | A1         | S      |

### P2 — Must fix before v1

| ID  | Description                                  | Impact                            | Owner   | Dependency | Effort |
| --- | -------------------------------------------- | --------------------------------- | ------- | ---------- | ------ |
| D1  | Move Instagram types out of `packages/types` | Frozen layer pollution            | Types   | A0         | S      |
| B6  | Make project references functional or remove | Misleading `tsc -b` story         | Build   | none       | S      |
| §10 | Validate `onMessage` sender                  | Hardening before external surface | Runtime | none       | S      |

### P3 — Can defer indefinitely

| ID        | Description                                                                                         | Impact        | Owner | Dependency | Effort |
| --------- | --------------------------------------------------------------------------------------------------- | ------------- | ----- | ---------- | ------ |
| Stub pkgs | Remove `ai`/`exporters`/`extractor`/`ocr`/`utils` empty pkgs and legacy connector dirs until needed | Graph clutter | Build | none       | S      |
| B5        | Delete codemod scripts                                                                              | Repo tidiness | Build | none       | S      |
| Docs      | Fill empty `README.md`/`ROADMAP.md`                                                                 | Onboarding    | Docs  | none       | S      |

---

## 7. Future Feature Readiness

| Feature                | Classification            | Rationale                                                                                                                                                                                                                    |
| ---------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OCR                    | **MINOR WORK**            | `IOcrEngine`, `IResourceCompleteness.ocr`, `IMedia.localUri` all exist. Blocked only by absence of a **media hydration stage** (today only `sourceUri` is captured, never downloaded). Add hydration, then OCR is a drop-in. |
| Video frame extraction | **MAJOR WORK**            | Requires media hydration **plus** binary/video frame sampling pipeline; none exists.                                                                                                                                         |
| AI enrichment          | **MINOR WORK**            | `ResourceState.ENRICHED` and the content-block model support it; add an engine-side enrichment stage. No contract changes.                                                                                                   |
| Semantic search        | **MAJOR WORK**            | Only `InMemoryStorage` exists; needs durable storage + embeddings/vector index.                                                                                                                                              |
| Markdown export        | **MINOR WORK**            | `IExporter` + `ExportFormat.MARKDOWN` defined; `exporters` package is empty — implement against the existing contract.                                                                                                       |
| Obsidian export        | **MINOR WORK**            | Builds directly on the Markdown exporter.                                                                                                                                                                                    |
| Notion export          | **MINOR WORK**            | Contract fits; needs a Notion API/auth client. No domain change.                                                                                                                                                             |
| Reddit connector       | **MINOR WORK** (after A1) | DOM connector; strategy/connector pattern is reusable. Blocked **only** by the content-script coupling (A1); after unification it is additive.                                                                               |
| LinkedIn connector     | **MINOR WORK** (after A1) | Same as Reddit; auth/session nuances are connector-local.                                                                                                                                                                    |
| YouTube connector      | **MINOR WORK** (after A1) | DOM connector; transcript maps to `BlockType.TRANSCRIPT`.                                                                                                                                                                    |
| PDF connector          | **MAJOR WORK**            | Runtime assumes browser DOM + Navigator + content script. PDF is non-DOM; requires decoupling "connector" from "browser extraction."                                                                                         |
| Generic web connector  | **MINOR WORK**            | `StructuralHeuristicStrategy` is a starting point; generalize selectors.                                                                                                                                                     |

**Gating rule:** No feature in this table begins until **A5 (Alpha) is complete**. DOM-connector readiness additionally requires **A1**.

---

## 8. Architecture Freeze

### Frozen Decisions — change only via a superseding RFC

- The normalized domain model (`IResource`, `IMedia`, `IContentBlock`, `ISource`, `IAuthor`) and its lifecycle (`ResourceState`).
- Execution-vs-domain separation: `ICrawlTask`/`TaskState` own execution; `IResourceCompleteness` owns completeness.
- Package boundaries and dependency direction (dependency-cruiser rules).
- Connector isolation: connectors discover/extract/normalize only — no storage, no orchestration.
- `CrawlController` as sole orchestrator.
- `Scheduler` as sole owner of the queue, priority, and retry.
- `Navigator` as sole owner of browser manipulation (scroll/modal/wait).
- Storage abstraction (`IStorageEngine`/`ITransaction`).
- Popup as monitoring-only (no execution).

### Flexible Decisions — open to iteration without an RFC

- Extraction implementation details (selectors, strategy internals, confidence thresholds) — **provided extraction stays owned by the connector** post-A1.
- Diagnostics internals (categories, report shape, snapshot size).
- Scheduler algorithm (priority scheme, ordering).
- Retry policy (attempt counts, backoff curve).
- Navigation strategy (modal vs. detail-page, timing constants).
- Performance optimizations (observer scoping, debounce windows, caching).

---

## 9. Success Metrics — Alpha Completion (all objectively measurable)

**Build & quality gates**

- `pnpm run depcruise` exits 0.
- `pnpm run typecheck` covers 10/10 packages and exits 0.
- `pnpm run lint` executes ≥1 task per source package and exits 0.
- `pnpm run format:check` exits 0.
- `pnpm run test` exits 0.
- `pnpm run build` exits 0.
- `find . -name "* [0-9]*" -not -path '*/node_modules/*'` returns 0 results.

**Observability**

- After a validation crawl, `EXPORT_DIAGNOSTICS` returns `metrics.extracted > 0`, `failures.length` reflecting actual failures (≥1 when failures occur), non-empty `strategyUsage`, and a numeric `memoryUsageMb`.
- Background `metrics.snapshot()` equals the independently counted `SessionManager` outcomes (exact match on discovered/extracted/failed/duplicates).

**Crawler behavior (against a real Saved collection of ≥100 items)**

- Successful crawl rate (extracted / discovered) **≥ 95%**.
- Retry success rate: **≥ 90%** of tasks that fail once and are retried eventually reach `COMPLETED` within `maxAttempts`.
- Duplicate-detection accuracy: **0** duplicate `IResource.id` persisted; dedup false-negative rate **= 0** on the validation set.
- Extraction latency: median end-to-end per resource **≤ 1500 ms**; p95 **≤ 4000 ms** (measured from `EXTRACTION_STARTED` to `RESOURCE_PERSISTED`).
- Modal-open latency recorded for every resource (non-null `openLatencyMs`).
- Memory limit: heap usage stays **≤ 300 MB** across a full scroll of the validation collection.
- Session recovery: after a forced service-worker restart mid-crawl, the crawl resumes with the queue intact and completes; **0** resources lost or double-persisted.
- Infinite-scroll stability: discovery continues past the initial viewport and terminates cleanly on end-of-grid with `scrollFailures = 0` for a healthy run.

---

## 10. Risks

### Technical

| Risk                                                    | Probability | Impact | Mitigation                                                                                     |
| ------------------------------------------------------- | ----------- | ------ | ---------------------------------------------------------------------------------------------- |
| MV3 service-worker eviction breaks the loop/queue       | High        | High   | A2: `chrome.alarms` + persisted queue snapshot; SW-restart integration test in A5.             |
| Quadratic discovery scan stalls large collections       | High        | High   | A4: debounce + subtree-scoped scanning + pre-traversal dedup; timing curve recorded.           |
| Instagram DOM changes break selectors during validation | Medium      | Medium | Strategy chain with fallbacks (restored in A1); fixtures; failure diagnostics for fast triage. |
| Extraction unification regresses parsing                | Medium      | High   | Existing fixtures + new single-path test before deleting the inline copy.                      |

### Architectural

| Risk                                                                                | Probability | Impact | Mitigation                                                                                                       |
| ----------------------------------------------------------------------------------- | ----------- | ------ | ---------------------------------------------------------------------------------------------------------------- |
| Stabilization re-introduces drift (e.g., new logic creeps back into content script) | Medium      | High   | Architecture Freeze (§8); depcruise; a guard test asserting no extraction logic in `apps/extension/src/content`. |
| Platform concepts re-leak into `packages/types`                                     | Medium      | Medium | D1 correction + a lint/grep guard for `instagram`/platform terms in `types`.                                     |
| Duplicate/ambiguous contracts reappear                                              | Low         | Medium | D2 fix + single-export assertion.                                                                                |

### Product

| Risk                                                                        | Probability | Impact | Mitigation                                                                   |
| --------------------------------------------------------------------------- | ----------- | ------ | ---------------------------------------------------------------------------- |
| Pressure to start OCR/connectors before Alpha completes                     | Medium      | High   | Gating rule (§7): no feature work until A5; this RFC is the gate.            |
| Alpha metrics look "good enough" while measurement is still partially wired | Low         | High   | §9 cross-check: background metrics must exactly match SessionManager counts. |

### Operational

| Risk                                                                                                 | Probability | Impact | Mitigation                                                                                  |
| ---------------------------------------------------------------------------------------------------- | ----------- | ------ | ------------------------------------------------------------------------------------------- |
| Working tree mutates outside version control (watcher/editor rewriting files, observed during audit) | High        | Medium | A0 first; commit the cleanup and freeze the tree before any other sprint.                   |
| CI gives false confidence (vacuous lint, partial typecheck)                                          | High        | High   | A0: make every gate real; re-run full CI locally before declaring A0 done.                  |
| Validation depends on a live, authenticated Instagram session                                        | Medium      | Medium | Document the validation environment; capture fixtures from the same session for regression. |

---

## 11. Final Recommendation

1. **Is Alpha implementation ready to continue?**
   **No — not as a validation exercise.** The design is ready to _build on_, but the crawler cannot yet produce valid measurements: diagnostics/metrics are unwired, scroll is not driven, the loop is MV3-fragile, and the build is not clean. Stabilization (A0–A4) must precede validation (A5).

2. **What should be implemented first?**
   **Sprint A0 (Repository Stabilization).** It is the root of the dependency graph: remove duplicate files, make typecheck/lint/format real and green, and commit to freeze the tree. Then A1 (extraction unification), because every later correctness and observability gain depends on a single, tested extraction path.

3. **What should not be touched until after Alpha?**
   All future features: OCR, video frame extraction, AI enrichment, semantic search, Markdown/Obsidian/Notion exporters, and the PDF/Reddit/LinkedIn/YouTube/generic connectors. Also defer the typed-bus migration beyond what A2 needs, project-reference correctness, and stub-package removal.

4. **What should remain permanently frozen?**
   The normalized domain model, execution-vs-domain split, package boundaries and dependency direction, connector isolation, CrawlController orchestration ownership, Scheduler queue/retry ownership, Navigator browser-manipulation ownership, the storage abstraction, and Popup-as-monitor. Changes here require a superseding RFC.

5. **What architectural mistakes are most important to avoid?**
   - Re-implementing extraction outside the connector (the original drift); keep parsing in the connector, DOM-only in the content script.
   - Leaking platform-specific concepts back into `packages/types`.
   - Treating the background as a long-lived page instead of an evictable MV3 worker (persist anything that must survive).
   - Building features on an unmeasured crawler — wire observability before declaring anything "validated."
   - Trusting vacuous CI gates; every gate must actually execute and fail loudly.

---

_End of RFC-0001. No repository changes were made by this document beyond creating the RFC file itself._
