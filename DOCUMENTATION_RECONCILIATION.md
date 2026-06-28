# Documentation Reconciliation

## Current Documentation Inventory

**Canonical (Core Source of Truth)**

- `README.md` (Root)
- `ROADMAP.md` (Root)
- `docs/architecture/ARCHITECTURE.md`
- `docs/architecture/PIPELINE.md`
- `docs/architecture/CONNECTOR_SYSTEM.md`
- `docs/architecture/STORAGE.md`
- `docs/guides/CONNECTOR_GUIDE.md`
- `docs/guides/CONTRIBUTING.md`
- `docs/guides/DEVELOPMENT.md`
- `docs/guides/TESTING.md`

**Historical (Past States / Proposed Work)**

- `docs/STATE_OF_THE_PROJECT.md` (End of Alpha snapshot)
- `docs/rfc/RFC-0001.md` (Stabilization Execution Plan)
- `docs/verification/phase-1.md` (Completed Sprint 1)
- `docs/verification/phase-2.md` (Completed Sprint 2)

**Verification (Testing & Reports)**

- `docs/verification/alpha-report.md` (Pending template)
- `docs/verification/navigation-evaluation.md`

**Temporary (Live Agent Session State)**

- `docs/live/ACTIVE_MILESTONE.md`
- `docs/live/CURRENT_STATE.md`
- `docs/live/DECISIONS.md`
- `docs/live/NEXT_TASK.md`
- `docs/live/SESSION_HANDOFF.md`

**Obsolete (Cluttering the repository)**

- `docs/archive/PROJECT_CHARTER.md`
- `docs/archive/PROJECT_CONTEXT.md`
- `docs/archive/README.md`
- `docs/archive/domain-model-ddd.md`
- `docs/archive/sprint-2-verification.md`

---

## Conflicts

**1. Extraction Implementation Status (A1 Sprint)**

- **Document**: `RFC-0001.md` states that extraction is duplicated in `content/index.ts` (`extractSingleResource`) and the connector chain is dead.
- **Conflicting Document**: Codebase (`apps/extension/src/content/index.ts`).
- **Which is correct**: The codebase.
- **Why**: The implementation in `content/index.ts` delegates extraction directly to `connector.extract(target)`, and the duplicate logic has been deleted.
- **Why it exists**: RFC-0001 was written before Sprint A1 was completed. It is a historical proposal document acting as the current truth.

**2. Observability & Lifecycle Wiring (A2, A3 Sprints)**

- **Document**: `RFC-0001.md` claims the crawler uses MV3-hostile primitives (`setInterval`), the queue isn't persisted, and observability collectors (`MetricsCollector`, `DiagnosticsCollector`) are not wired.
- **Conflicting Document**: `docs/verification/phase-2.md` and Codebase (`apps/extension/src/background/crawl-controller.ts`).
- **Which is correct**: `phase-2.md` and the codebase.
- **Why**: `crawl-controller.ts` uses `setTimeout` chains, `chrome.alarms`, accurately calls `metrics.recordExtracted`, and persists the scheduler queue to `chrome.storage.session`.
- **Why it exists**: `RFC-0001` proposed the work. `phase-2.md` documented its completion.

**3. Storage Engine Persistence (Alpha vs. Beta-0)**

- **Document**: `docs/STATE_OF_THE_PROJECT.md` states storage is exclusively `InMemoryStorage` for Alpha and durable storage is the next milestone. `README.md` lists in-memory storage as a current limitation.
- **Conflicting Document**: `docs/architecture/STORAGE.md` and Codebase (`apps/extension/src/background/index.ts`).
- **Which is correct**: `STORAGE.md` and the codebase.
- **Why**: `background/index.ts` actively initializes `IndexedDbStorageEngine` (Phase 3.5), requests `navigator.storage.persist()`, and falls back to memory only if IndexedDB is unavailable.
- **Why it exists**: Engineering progressed into Beta features (durable storage) before completing Alpha Validation, leaving the high-level roadmap and "state of project" summaries outdated.

**4. Roadmap Timeline**

- **Document**: `ROADMAP.md` claims durable storage (`IndexedDB`) and media capture are Beta features that have not been started.
- **Conflicting Document**: Codebase.
- **Which is correct**: The codebase.
- **Why**: The `IndexedDbStorageEngine`, OPFS `MediaStore`, and `MediaCaptureCoordinator` are already merged into the extension background.
- **Why it exists**: The roadmap was not updated as features were delivered asynchronously.

---

## Recommended Actions

- `README.md`: **UPDATE** - Remove "Storage is in-memory only" from limitations.
- `ROADMAP.md`: **UPDATE** - Mark Durable Storage and Media Capture as completed under Beta, despite Alpha validation still pending.
- `docs/architecture/*`: **KEEP** - They accurately reflect the implemented architecture.
- `docs/guides/*`: **KEEP** - Standard development guides.
- `docs/live/*`: **KEEP** - Essential for AI agent session continuity.
- `docs/verification/alpha-report.md`: **KEEP** - Essential template for pending validation.
- `docs/verification/navigation-evaluation.md`: **ARCHIVE**
- `docs/verification/phase-1.md` & `phase-2.md`: **ARCHIVE** - Historical sprint walk-throughs no longer needed once the codebase is the truth.
- `docs/STATE_OF_THE_PROJECT.md`: **DELETE** - It contains misleading, outdated assumptions about storage and the timeline that contradict the actual codebase.
- `docs/rfc/RFC-0001.md`: **ARCHIVE** - Its proposed work (A0-A4) is mostly implemented, making its "proposed" status a trap for future contributors.
- `docs/archive/*`: **DELETE** - Git history exists for a reason. Archived markdown files only confuse LLMs during RAG indexing.

**Justification for Actions**: All documents pretending to describe the current state but reflecting historical moments (RFC-0001, STATE_OF_THE_PROJECT, phase-1/2) act as poison in the context window. They must be removed from the active path. The active path should only contain timeless architecture docs and live session state.

---

## Canonical Documentation Structure

```
/README.md
/ROADMAP.md
/docs/
  architecture/
    ARCHITECTURE.md
    PIPELINE.md
    CONNECTOR_SYSTEM.md
    STORAGE.md
  guides/
    CONNECTOR_GUIDE.md
    CONTRIBUTING.md
    DEVELOPMENT.md
    TESTING.md
  live/
    ACTIVE_MILESTONE.md
    CURRENT_STATE.md
    DECISIONS.md
    NEXT_TASK.md
    SESSION_HANDOFF.md
  reports/
    alpha-report.md
```

---

## Reading Order

If a new Staff Engineer joins the project tomorrow, they should read the documents in this exact order to build their mental model efficiently:

1. `README.md` (High-level vision & execution instructions)
2. `ROADMAP.md` (Where the project is today)
3. `docs/architecture/ARCHITECTURE.md` (System layers & abstractions)
4. `docs/architecture/PIPELINE.md` (The orchestration loop)
5. `docs/architecture/STORAGE.md` (The durability model)
6. `docs/architecture/CONNECTOR_SYSTEM.md` (How extraction connects)
7. `docs/guides/DEVELOPMENT.md` (How to actually write code)
8. `docs/live/SESSION_HANDOFF.md` (What happened five minutes ago)

---

## Documentation Debt

Ranked by severity:

1. **Contradictory Project State**: `STATE_OF_THE_PROJECT.md` asserts memory-storage is active, directly contradicting the live IndexedDB integration.
2. **Obsolete RFC Assumptions**: `RFC-0001.md` reads as a pending proposal, masking the fact that Sprints A1-A3 are already merged in the codebase.
3. **Outdated Milestones**: `ROADMAP.md` and `README.md` incorrectly list the persistent storage and media capture features as unbuilt.
4. **Duplicated History**: `docs/archive/` and `docs/verification/phase-*.md` clutter search results and context windows with outdated conclusions.

---

## Missing Documents

- **Deployment/Publishing Guide**: There is no documentation detailing the process for packaging and releasing the extension.
- **Media Capture Pipeline Reference**: OPFS Blob Backend and the MediaCaptureCoordinator were introduced in Beta-1 but lack dedicated architectural documentation outside of inline code comments.
- **Agent Protocol Guide**: A document detailing how the `docs/live/` folder should be maintained by AI agents during handoffs.

---

## Final Recommendation

To achieve one source of truth with maximum usefulness for future AI sessions and human contributors, the repository must ruthlessly purge historical snapshot documents (`STATE_OF_THE_PROJECT`, `RFC-0001`, `phase-*.md`, `archive/*`).

The architecture documents must become living references, updated in lockstep with the code. The project state should be driven entirely by `docs/live/CURRENT_STATE.md` and `ROADMAP.md`. We must rely on git history rather than archiving old files into folders where they will inevitably confuse LLM semantic searches.
