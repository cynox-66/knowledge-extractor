# Current State Dashboard

## Current Milestone
Beta-3 (Knowledge Ownership & Export) — **COMPLETE**

## Current Objective
Alpha Validation against live Instagram — fixing the navigation/extraction foundation that was never exercised by the fixture-based suite. **The full navigation redesign (P0–P3) is implemented.** The live smoke harness + runbook (`SMOKE.md`) are the standing way to validate each surface before further feature work.

## Completed Milestones
- Alpha Stabilization (Sprints A0-A4)
- Beta-0 Phase 3.5 (Unified Persistence: IndexedDB + OPFS)
- MV3 Lifecycle & Orchestration Stabilization
- Extraction Unification
- Beta-1.5 (Enrichment Read Path)
- Beta-2 Phase 4A (OCR Engine)
- Beta-2 Phase 4B (Enrichment Cursor Checkpointing)
- Beta-2 Phase 4C (Self-rescheduling)
- Beta-2 Phase 4D (ENRICHED state promotion & Runtime Wiring)
- Beta-3 Milestone M1 (Export Contracts)
- Beta-3 Milestone M2 (ResourceProjector + JSON Serializer)
- Beta-3 Milestone M3 (Markdown Serializer)
- Beta-3 Milestone M4 (Export Orchestration End-to-End)
- Beta-3 Milestone M5 (ObsidianSerializer)
- Beta-3 Milestone M6 (Media Retention Policy + MediaJanitor)
- **Beta-3 Milestone M7 (Incremental Export)** — COMPLETE

## Active Branch
`main`

## Current Blockers
None.

## Recent Engineering Changes
- **Navigation Redesign — P3 (Validation infrastructure):**
  - **In-extension `SmokeHarness`** (`apps/extension/src/background/smoke-harness.ts`): dev-triggered via the `RUN_SMOKE` message, runs one bounded crawl on the active surface, polls metrics, stops, and returns a structured PASS/FAIL `ISmokeReport` (per-assertion discovered/extracted/persisted > 0). Pure orchestration over injected crawl/metrics seams — no Chrome APIs inside, fully unit-tested.
  - **Automated smoke gates:** `tests/smoke.test.ts` (real extract → normalize → persist; carousel multi-slide) and `tests/smoke-harness.test.ts` (pass/timeout/partial-failure).
  - **`SMOKE.md` runbook:** automated-gate commands + the authoritative live procedure with per-surface pass criteria (home feed, saved/profile grid, carousel).
  - Gates green (183 ext + connector; depcruise 145 modules, 0 violations).
- **Navigation Redesign — P2 (Completeness & robustness):**
  - **Carousel traversal (RCA-7):** new `connectors/instagram/src/carousel.ts` (`findCarouselNext`); `Navigator.advanceCarousel(scope)`; the content script walks every slide, unioning media, bounded by `MAX_CAROUSEL_SLIDES`. Extraction is no longer a single-slide snapshot.
  - **Incremental + surface-specific discovery (RCA-5/9, RFC-0001 A4):** `MutationObserver` scans only added subtrees (incl. the added node itself — fixed a real miss where an appended `<a>` thumbnail was skipped); `scanDOM` splits into surface-selected `scanGridLinks` / `scanArticles`.
  - **Fail-fast retries (RCA-9):** `Scheduler.failPermanently`; controller classifies "not found in DOM" navigation/extraction failures as non-retryable.
  - Tests: new `carousel.test.ts`, `scheduler.test.ts`; expanded `discovery-engine.test.ts` (incremental + surface-specific). Gates green (178 ext + 25 connector; depcruise 142 modules, 0 violations).
- **Navigation Redesign — P1 (Surface-aware navigation):** Fixes the universal-modal assumption and the profile-wandering bug.
  - **Surface abstraction (RCA-1/2/4):** new `connectors/instagram/src/surface.ts` — `detectSurface(url)` returns a `SurfaceDescriptor` (kind, open mode, scroll-container selectors, `isOnSurface` route guard) + robust multi-candidate `findOpenPostModal`. Exported from the connector; consumed by the content-script Navigator (downward dep, depcruise-clean).
  - **Navigator rewrite:** `open(uri, surface)` extracts home-feed posts **in place** (never clicks a feed permalink) and opens grid posts as a confirmed modal; `scroll(surface)` drives the surface's real scroll container; `close()` verifies the modal actually closed.
  - **DiscoveryEngine route guard (RCA-2/5):** pinned to the start surface; never harvests links inside an open modal; stops scanning when navigated off-surface.
  - **Content script** captures the crawl surface at `RUN_PIPELINE` and threads it through all navigation handlers.
  - Tests: new `surface.test.ts` (detection, route guard, modal detection) + `discovery-engine.test.ts` (modal exclusion, off-surface skip). Gates green (175 ext + 18 connector; depcruise 139 modules, 0 violations).
- **Navigation Redesign — P0 (Pipeline Unblock):** Three foundation fixes ahead of P1 surface-aware navigation.
  - **Tab pinning (RCA-8):** `ICrawlSession.tabId` (additive); `startCrawl` pins the active Instagram tab and refuses to start without one; all crawl + media-capture messaging targets the pinned id; the crawl finishes `tab-closed` if it is removed. Eliminates the `chrome.tabs.query({active,currentWindow})` anti-pattern.
  - **Discovery readiness barrier (RCA-3):** `DISCOVERY_SETTLE_MS` settle window gates scroll/terminate decisions; end-of-feed now requires `MAX_EMPTY_SCROLLS` *consecutive* unproductive scrolls (no single no-growth scroll terminates). Fixes the Saved-Posts instant `end-of-feed` race.
  - **Knowledge-first persistence (RCA-6):** resources persist as `EXTRACTED` before capture; media hydration is best-effort/non-fatal and re-persists on success. Extracted knowledge is never discarded by a media failure.
  - Tests: media-capture suite threads the pinned `tabId`; new SessionManager test asserts `tabId` survives restart. Gates green (175 tests).


- **Beta-3 Milestone M7 (Incremental Export):**
  - Implemented `IExportManifest` for durable per-target watermark tracking.
  - Added incremental export capability to `ExportCoordinator`, which reliably filters out previously exported resources using deterministic `source.extractedAt` checks.
  - Implemented `embed-remote` mode for on-demand media re-fetching, with graceful fallback to remote links if fetching fails (due to network or authentication barriers).
  - All architecture invariants (purity of `packages/export`, MV3-safe orchestration, additive changes) rigorously preserved.

## Current Risks
- **CRITICAL - Missing `eng.traineddata` asset:** The Tesseract.js English language data file (~10 MB) is not bundled via npm. It must be manually downloaded and placed at `apps/extension/public/tesseract/lang/eng.traineddata` before building, otherwise OCR will fail at runtime.

## Current Technical Debt
- `Scheduler` and `MetricsCollector` lack automated unit test coverage.
- Legacy message bus uses raw string actions instead of strictly typed event unions.
- `IReconciliationReport` is logged but not persisted — no observable history of passes.
- STORE-only ZIP (no compression); markdown bundles are uncompressed.
- Export `localPath` still lacks file extensions — the writer can suffix extensions from MIME type in a future optimisation.
- YAML value serialization logic is duplicated across `MarkdownSerializer` and `ObsidianSerializer`.
- Cross-resource same-author wikilinks not implemented (would require a global index outside the pure projection layer).
- Policy configuration is static at startup (hard-coded 500 MB).
- Incremental filter granularity uses `extractedAt` rather than an update timestamp.
- No UI mechanism to manually reset the manifest watermark.

## Next Engineering Step
Beta-3 Closeout / Architecture Review. See `40_NEXT_TASK.md`.

## Definition of Current Success
Beta-3 is fully architecturally validated. Knowledge is permanent (ADR-010), the pure layer handles export projection safely (ADR-011, ADR-012), new serializers are trivial to add (ADR-013), and media management is governed purely by policy (ADR-014). The system is highly robust and prepared for the next architecture phase.
