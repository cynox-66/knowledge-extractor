# Export Architecture (Beta-3)

> Canonical reference for the Beta-3 **Knowledge Ownership & Export** subsystem.
> Status: **Frozen** (architecture). Implementation proceeds milestone-by-milestone
> from the roadmap in this document. If implementation disagrees with this
> document, the implementation wins — report the mismatch before editing.
>
> Companion ADRs: ADR-010 … ADR-014 in [`.claude/docs/30_DECISIONS.md`](../../.claude/docs/30_DECISIONS.md).

---

## 1. Goals

Beta-2 made knowledge **durable and enriched, but trapped** inside IndexedDB/OPFS.
Beta-3 has exactly one purpose: **egress with ownership** — let the user pull their
knowledge out of the extension into open, portable, tool-agnostic artifacts they
control, and establish the boundaries that let future targets (Logseq, Notion,
embeddings, cloud sync) attach _without redesign_.

Concretely, Beta-3 ships:

1. **JSON export** (NDJSON — the lossless, AI-ready, re-importable schema).
2. **Markdown export** (one note per resource + attachments).
3. **Obsidian export** (a vault: markdown + `attachments/` + wikilinks + tags).
4. A **governed Knowledge/Media boundary** with a tiered, configurable media
   retention policy that keeps storage bounded at hundreds of thousands of resources.

**Non-goals (explicitly out of scope for Beta-3):** sync engines, AI/embedding
pipelines, plugin frameworks, thumbnail generation, CSV, a UI overhaul, and any
mutation of completed Beta-2 systems.

---

## 2. Design principles

1. **Knowledge is permanent. Media is policy-managed.** (ADR-010) The knowledge
   layer is self-sufficient: every export of a resource is complete even if its
   media bytes were evicted.
2. **Export is a read-only projection.** It never mutates `ResourceState` by
   default and is fully idempotent and repeatable (ADR-013).
3. **Serializers are pure.** They transform an `IExportItem` into file parts with
   no access to storage, the network, or the MV3 runtime — so they are trivially
   unit-testable from fixtures.
4. **Bytes never flow through serializers.** Binary parts carry only a `mediaId`;
   the Layer-4 coordinator resolves bytes from `IMediaStore` at write time. Memory
   stays bounded to one page of resources per tick.
5. **MV3-safe by construction.** Export streams via the existing
   `IResourceQueryable` cursor, runs on a self-scheduling `setTimeout` chain with a
   `chrome.alarms` watchdog, and persists a resumable progress cursor.
6. **Explicit over generic.** No factories, no plugin discovery, no generic job
   runner. A new export target is one `ISerializer` plus one line in a static
   lookup `Map` (ADR-013).
7. **Additive only.** `IResource`, `IStorageEngine`, `IMediaStore`, and
   `ResourceState` are not modified. New contracts are added; the speculative
   `IExporter`/`ExportFormat` stub is deprecated and replaced.

---

## 3. Subsystem overview

| Component                                                                          | Layer | Responsibility                                                                                                                                          |
| ---------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Export contracts (`packages/types/src/export/`)                                    | 0     | `IExportItem`, `IExportMediaRef`, `IExportPart`, `ISerializer`, `IExportRequest`, `IExportProgress`, `IExportResult`, `ExportTarget`, `MediaInclusion`. |
| `MediaRetentionPolicy` (`packages/types/src/storage/`)                             | 0     | Additive retention policy type.                                                                                                                         |
| `ResourceProjector` (`packages/export`)                                            | 2     | Pure `IResource` + media-presence → `IExportItem`. Assigns media relative paths once.                                                                   |
| `JsonSerializer` / `MarkdownSerializer` / `ObsidianSerializer` (`packages/export`) | 2     | Pure `IExportItem` → `IExportPart[]`.                                                                                                                   |
| `ExportCoordinator` (`apps/extension/src/background/export/`)                      | 4     | MV3-safe orchestration: pages resources, builds presence maps, drives projector + serializer, streams parts to the writer, persists progress.           |
| `ExportWriter` (`apps/extension/src/background/export/`)                           | 4     | Concrete sink: assembles parts into a ZIP (markdown/obsidian) or a single file (NDJSON) and triggers the browser download.                              |
| Serializer lookup `Map<ExportTarget, ISerializer>`                                 | 4     | Constructed in the composition root; the single extension seam.                                                                                         |
| `MediaJanitor` (`apps/extension/src/background/`)                                  | 4     | Alarm-driven retention enforcement over `IMediaStore`.                                                                                                  |

---

## 4. Dependency diagram

```
Layer 0  packages/types            (+ export contracts, + MediaRetentionPolicy — additive)
   ↑
Layer 1  packages/shared
   ↑
Layer 2  packages/storage   ⟂   packages/export        ← NEW. Siblings, mutually isolated
   ↑                                ↑                     (enforced by dependency-cruiser:
Layer 3  connectors/* (instagram, …)                       export must not import storage,
   ↑                                                        storage must not import export)
Layer 4  apps/extension
         └ background/
             ├ export/   ExportCoordinator · ExportWriter · serializer registry (Map)
             └ MediaJanitor
```

`packages/export` imports **only** Layer 0/1. It never imports `packages/storage`
(it works on `IExportItem` and injected data). All infrastructure-touching code
(storage paging, media reads, ZIP assembly, downloads, MV3 ticks) lives at Layer 4,
exactly like `CrawlController` and the enrichment loop.

**New dependency-cruiser rule (added in Milestone M2):**

| Rule                          | Effect                                                              |
| ----------------------------- | ------------------------------------------------------------------- |
| `export-and-storage-isolated` | `packages/export` cannot import `packages/storage`, and vice versa. |

---

## 5. Interfaces (canonical)

These replace the deprecated `packages/types/src/export/exporter.ts` stub
(`IExporter`, `ExportFormat`). The stub is removed in M1.

```ts
// packages/types/src/export/  (Layer 0)

/** The user-facing export targets. One enum — no separate format/target taxonomy. */
export enum ExportTarget {
  JSON = 'json', // NDJSON: one resource object per line
  MARKDOWN = 'markdown', // one .md note per resource + attachments/
  OBSIDIAN = 'obsidian', // vault: markdown + attachments/ + [[wikilinks]] + tags
}

/** How media bytes are treated for this export. */
export type MediaInclusion =
  | 'link-local' // write present blobs into the bundle and link them;
  // absent blobs fall back to a remote sourceUri link.
  | 'none'; // never write blobs; link to remote sourceUri (or omit if none).
// NOTE: download-on-demand ('embed-remote') is deferred to M7.

/** A resolved reference to one media asset within an export. */
export interface IExportMediaRef {
  mediaId: string; // == IMedia.id, key into IMediaStore
  type: MediaType;
  sourceUri: string; // provenance + remote fallback link
  localPath?: string; // relative bundle path; set only when the blob is present
  // AND inclusion === 'link-local'
}

/**
 * The canonical, format-agnostic projection of ONE resource.
 * Decoupled from IResource so the export schema never leaks internal fields
 * (state, completeness) and never churns when the domain model evolves.
 * Ephemeral: produced per-export, never persisted.
 */
export interface IExportItem {
  resourceId: string;
  kind: string;
  frontmatter: Record<string, unknown>; // title, author, sourceUrl, dates, tags
  body: IContentBlock[]; // the knowledge, still structured
  media: IExportMediaRef[]; // resolved manifest (no bytes inline)
  children?: IExportItem[]; // carousels / threads
}

/** One file (or one appended chunk) in the output bundle. */
export interface IExportPart {
  path: string; // relative path within the bundle
  kind: 'text' | 'binary';
  text?: string; // present when kind === 'text'
  mediaId?: string; // present when kind === 'binary'; coordinator resolves bytes
}
// WRITER SEMANTICS: text parts sharing one `path` are appended in stream order
// (this is how NDJSON accumulates into a single file); binary parts are written once.

/** A pure format renderer. Lives in packages/export. */
export interface ISerializer {
  readonly target: ExportTarget;
  serializeItem(item: IExportItem): IExportPart[];
}
// NOTE: no `finalize` and no IExportContext — removed as unused and as a 100k
// memory hazard. Add a finalize seam only if a future target needs a global index.

/** A user-initiated export request. Selection is by lifecycle state in Beta-3. */
export interface IExportRequest {
  target: ExportTarget;
  state: ResourceState; // e.g. ENRICHED
  media: MediaInclusion;
}

/** Persisted to control-state for MV3 resumability and UI progress. */
export interface IExportProgress {
  requestId: string;
  target: ExportTarget;
  cursor?: string; // IResourceQueryable continuation token
  resourcesWritten: number;
  mediaWritten: number;
  startedAt: string;
  updatedAt: string;
  done: boolean;
}

/** Returned to the UI when an export completes. */
export interface IExportResult {
  requestId: string;
  target: ExportTarget;
  resourcesExported: number;
  mediaIncluded: number;
  mediaMissing: number;
  bytes: number;
  completedAt: string;
}
```

The pure projector signature (implemented in `packages/export`, M2):

```ts
// project() is pure. The coordinator supplies `presentMediaIds`, gathered from
// IMediaStore, so the projector can assign localPath consistently with the bytes
// the writer will actually write — without packages/export importing storage.
function project(
  resource: IResource,
  presentMediaIds: ReadonlySet<string>,
  inclusion: MediaInclusion,
): IExportItem;
```

Retention contract (additive, M6):

```ts
// packages/types/src/storage/  (Layer 0)
export interface IMediaRetentionPolicy {
  fullMediaMode: 'keep' | 'cache'; // keep = never evict; cache = LRU-evict above cap
  maxCacheBytes?: number; // soft cap for full-resolution bytes (Tier 2)
  retainVideo: boolean; // default false (video opt-out)
  // Thumbnails are a future tier; generation is out of scope for Beta-3.
}
```

---

## 6. Data flow

```
[IndexedDB]                                   [OPFS]
  IResource                                     media bytes
     │ IResourceQueryable (cursor-paged)           │ IMediaStore
     ▼                                              │
  ExportCoordinator (Layer 4, tick loop)           │
     │  1. read one page of resources (state-filtered)
     │  2. build presentMediaIds via IMediaStore.exists/getMetadata ◄────────┘
     │  3. project(resource, presentMediaIds, inclusion) ─► IExportItem  (Layer 2, pure)
     │  4. serializer.serializeItem(item) ─────────────────► IExportPart[] (Layer 2, pure)
     │  5. for each part:
     │        text  → ExportWriter.appendText(path, text)
     │        binary→ bytes = IMediaStore.get(mediaId); ExportWriter.writeBinary(path, bytes)
     │  6. persist IExportProgress (cursor); yield; self-schedule next tick
     ▼
  ExportWriter.finalize() → Blob (zip | single file) → chrome.downloads → user owns it
```

Resources are **never mutated** by this flow (ADR-013).

---

## 7. Export lifecycle

```
REQUESTED   user picks target + media inclusion in the popup/options UI
   ↓
STREAMING   per tick: page resources → presence map → project → serialize → write parts;
            persist progress cursor; self-schedule; watchdog via chrome.alarms
   ↓
FINALIZING  ExportWriter assembles the ZIP / single file
   ↓
DELIVERED   chrome.downloads hands the artifact to the user   | FAILED (diagnostic
                                                                recorded; resumable
                                                                from the persisted cursor)
```

A worker eviction mid-export resumes from the persisted `IExportProgress.cursor`
rather than restarting.

### Full vs incremental

Beta-3 ships **full snapshot** export only (M1–M5). It is the canonical, expected
behavior. **Incremental** export is deferred to M7 and, when built, tracks a
per-target watermark in a separate `IExportManifest` record — it does **not**
overload `ResourceState.EXPORTED`, which stays a coarse, optional UX flag.

---

## 8. Ownership — Knowledge Layer vs Media Layer (ADR-010)

|                       | **Knowledge Layer**                                                             | **Media Layer**                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Contents              | `IResource`: content blocks, OCR transcripts, captions, source URIs, provenance | Raw image/video/audio **bytes** (+ future thumbnails)                                                                     |
| Substrate             | IndexedDB (`IStorageEngine`)                                                    | OPFS (`IMediaStore`)                                                                                                      |
| Lifecycle             | **Permanent** — never evicted by policy                                         | **Policy-managed** — evictable under the invariant below                                                                  |
| Owner                 | The user; the domain model                                                      | The retention policy; the `MediaJanitor`                                                                                  |
| Re-derivable?         | No — canonical                                                                  | Bytes: sometimes (URLs expire); OCR text is **already promoted into the knowledge layer**, so eviction loses no knowledge |
| Indexed by future AI? | Yes (text)                                                                      | No                                                                                                                        |

**Boundary rule:** the knowledge layer must be self-sufficient for export and
(future) search without the media layer present. Media absence degrades _visual
fidelity_, never _knowledge_.

**Eviction invariant (the safety rule the whole strategy hangs from):**

> A full-resolution media blob is eligible for cache eviction **only** when its
> parent resource is `ENRICHED` or `EXPORTED` **and** not user-pinned. Bytes for
> `DISCOVERED` / `EXTRACTED` / `HYDRATED` resources are retained, because their
> knowledge has not yet been extracted and the source may no longer be fetchable.

---

## 9. Storage strategy

No new storage substrate. Beta-3 reuses, unchanged:

- `IStorageEngine` + `IResourceQueryable` — cursor-paged, state-filtered reads
  that bound per-tick heap (the same contract the enrichment loop already relies on).
- `IMediaStore` — `exists` / `getMetadata` (presence maps), `get` (bytes for the
  writer), `list` + `lastAccess` + `statistics` (LRU + quota for the janitor),
  `delete` (eviction). No signature changes.
- `IControlStateStore` — persists `IExportProgress` for resumability; persists the
  pinned-resource id set and the `IMediaRetentionPolicy` (policy may also live in
  `chrome.storage.local`, which is reserved for user preferences).

The export artifact itself is **not** stored in the extension — it is handed
straight to `chrome.downloads`. The extension does not become a second copy.

---

## 10. Retention strategy (ADR-014) — sized for 100k+ resources

Tiers:

```
Tier 0  Knowledge       IndexedDB  PERMANENT   IResource incl. OCR text + source URIs
Tier 1  Thumbnail       OPFS       (FUTURE)    one small preview per resource — generation
                                               deferred; policy supports the tier
Tier 2  Full-res bytes  OPFS       CACHE       governed: keep | LRU-cap | video opt-out
Tier 3  Pinned          OPFS       PERMANENT   user-marked; exempt from all eviction
```

**Default production policy:** `fullMediaMode: 'cache'`, a `maxCacheBytes` soft cap,
`retainVideo: false`. Above the cap, the `MediaJanitor` evicts least-recently-used
full-resolution blobs (using the existing `IMediaMetadata.lastAccess`), honoring the
eviction invariant (skip non-`ENRICHED`, skip pinned).

**Mechanism:** `MediaJanitor` is an MV3-safe, `chrome.alarms`-driven pass — the same
family as the enrichment scheduler — that reads `IMediaStore.statistics()` + `list()`,
selects eviction candidates, and calls `IMediaStore.delete()`. It is the _only_
component that deletes media for capacity reasons.

Why this scales: knowledge is text and stays small even at 100k resources; the
unbounded cost is media bytes, and the cap + LRU + invariant put a hard ceiling on
OPFS usage while never destroying un-extracted knowledge.

---

## 11. Export strategy (extensibility without a framework — ADR-013)

A new target is added in two edits:

1. Implement `ISerializer` in `packages/export`.
2. Add one entry to the static `Map<ExportTarget, ISerializer>` in the composition root.

No dynamic discovery, no manifest scanning, no sandboxing, no lifecycle hooks. This
is a lookup table, not a plugin system. A plugin framework becomes justifiable only
if **third parties** ship serializers the team does not control — explicitly out of
scope. The `Map` upgrades to that cleanly if it ever is.

**Future systems attach at existing seams, with no change to Beta-3 code:**

- _Embeddings / semantic search_ — an indexer is just another consumer of
  `IExportItem` (reads `body`/`frontmatter`, emits vectors). It indexes the
  **knowledge layer only**. **Never add vector fields to `IResource`**; derived AI
  artifacts live in a future separate store keyed by `resourceId`, exactly as media
  metadata is separate today.
- _Cloud sync_ — arrives as an alternate `ExportWriter` backend (network instead of
  ZIP). Local-first is preserved: sync is an explicit user-invoked export, never
  automatic.
- _Logseq / Notion_ — additional `ISerializer` implementations.

---

## 12. Risks

| #   | Risk                                                                | Severity | Mitigation                                                                                                    |
| --- | ------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| R1  | Evicting media that is no longer fetchable → permanent loss         | High     | Eviction invariant (post-`ENRICHED` only) + pin tier (ADR-010/014).                                           |
| R2  | MV3 heap blowout building a giant string/bundle for 100k resources  | High     | Stream via `IResourceQueryable`; NDJSON + append-by-path; bytes pulled per-part; persisted cursor.            |
| R3  | OOM assembling the ZIP in memory                                    | Med-High | Validate a streaming-capable ZIP approach in M4; cap part sizes; document running export while crawl is idle. |
| R4  | Media-link drift (markdown link vs file written)                    | Med      | `localPath` assigned once in the projector from the coordinator's presence map.                               |
| R5  | Obsidian wikilink collisions / illegal filenames                    | Med      | Deterministic, sanitized note paths derived from `resourceId`.                                                |
| R6  | DB contention between export reads and live crawl/enrichment writes | Med      | Read-only paged cursors; yield between ticks; prefer exporting when crawl idle.                               |
| R7  | `chrome.downloads` permission / large-file UX                       | Low-Med  | Confirm `downloads` permission in M4; surface size in progress UI.                                            |

---

## 13. Implementation roadmap

Each milestone is independently shippable and ends with tests + a docs-sync pass
(Engineering Rules 9, 10). One milestone per Claude Sonnet session.

### M1 — Export contracts (Layer 0)

- **Objective:** Define the canonical contracts; remove the deprecated stub.
- **Why it exists / ordering:** Freezing interfaces first is cheap now and
  expensive later; every later milestone derives from these types. **Unlocks
  M2–M7.**
- **Files:** `packages/types/src/export/{exporter.ts→replaced, index.ts}`,
  `packages/types/src/storage/` (add `IMediaRetentionPolicy`).
- **Layers:** 0.
- **Interfaces:** all of §5.
- **Tests:** type-level compilation; `dependency-cruiser` green; assert no runtime
  package imports the removed `IExporter`.
- **Risks:** breaking the unused stub — verify no live importers first.
- **Exit criteria:** types compile and are exported; stub gone; cruiser + `tsc` green.

### M2 — `packages/export` + projector + JSON (NDJSON) serializer (Layer 2)

- **Objective:** Stand up the pure export package; implement `project()` and
  `JsonSerializer` (NDJSON). Add the `export-and-storage-isolated` cruiser rule.
- **Why / ordering:** Pure, storage-free logic is built and fully tested before any
  MV3 wiring. JSON is the simplest, lossless target and validates the projection
  model. **Unlocks M3, M4.**
- **Files:** new `packages/export/{package.json,tsconfig,src/projector.ts,src/json-serializer.ts,src/index.ts}`,
  `.dependency-cruiser.js` (new rule), workspace config.
- **Layers:** 2.
- **Interfaces:** `project()`, `ISerializer`, `IExportItem`, `IExportPart`.
- **Tests:** fixture `IResource` → expected `IExportItem`; projector media-path
  assignment with present/absent ids; NDJSON line-per-resource output; purity (no
  storage import — enforced by cruiser).
- **Risks:** projector/coordinator responsibility drift — keep `project()` pure,
  presence supplied by caller.
- **Exit criteria:** given in-memory resources + a presence set, produce valid
  NDJSON; cruiser proves isolation.

### M3 — Markdown serializer (Layer 2)

- **Objective:** `MarkdownSerializer`: YAML frontmatter + block renderers
  (`HEADING`/`QUOTE`/`CODE`/`TRANSCRIPT`/`LIST_ITEM`/`TEXT`) + `link-local` media.
- **Why / ordering:** Builds on the same pure model as M2; the Markdown body
  renderer is reused by Obsidian (M5), so it must exist first. **Unlocks M5; second
  target for M4.**
- **Files:** `packages/export/src/markdown-serializer.ts` (+ shared block renderer).
- **Layers:** 2.
- **Interfaces:** `ISerializer`, `IExportItem`, `IExportPart`.
- **Tests:** each block type → expected markdown; media present → local link, absent
  → remote link; children rendering; deterministic output.
- **Risks:** block-type coverage gaps — table-test every `BlockType`.
- **Exit criteria:** fixture `IExportItem` → correct `.md` part(s).

### M4 — Export orchestration end-to-end (Layer 4)

- **Objective:** `ExportCoordinator` (MV3 tick loop over `IResourceQueryable`,
  presence maps, progress persistence, resumability), concrete `ExportWriter`
  (ZIP for markdown, single file for NDJSON), serializer `Map`, composition-root
  wiring, and an Export control in the popup/options UI. Deliver downloadable JSON
  and Markdown.
- **Why / ordering:** First milestone with real user value; depends on M2+M3
  serializers. Establishes the MV3 + writer + UI machinery reused by M5. **Unlocks
  M5, M6, M7.**
- **Files:** `apps/extension/src/background/export/{coordinator.ts,writer.ts,registry.ts}`,
  `apps/extension/src/background/index.ts` (wiring), popup/options UI, messaging
  types, `manifest.json` (confirm `downloads` permission).
- **Layers:** 4 (consumes Layer 0/2 contracts + Layer 2 storage/media).
- **Interfaces:** `IExportRequest`, `IExportProgress`, `IExportResult`,
  `IResourceQueryable`, `IMediaStore`, `ISerializer`.
- **Tests:** coordinator paging + resume-from-cursor (fake storage); writer ZIP +
  single-file assembly; binary part → `IMediaStore.get`; end-to-end integration on
  a seeded store.
- **Risks:** R2/R3/R6/R7 (memory, ZIP, contention, downloads permission).
- **Exit criteria:** user clicks Export → receives a valid `.json` (NDJSON) or
  markdown `.zip`; export survives a simulated worker eviction.

### M5 — Obsidian target (Layer 2 + wiring)

- **Objective:** `ObsidianSerializer`: vault layout, `attachments/`, `[[wikilinks]]`
  (carousel children, same author), tag frontmatter — reusing M3's body renderer.
  Register in the `Map`; add to the UI.
- **Why / ordering:** Highest-value target; depends on M3 (body renderer) and M4
  (writer/UI). Proves the "new target = one serializer + one Map entry" claim.
  **Unlocks nothing further; completes the export feature set.**
- **Files:** `packages/export/src/obsidian-serializer.ts`,
  `apps/extension/src/background/export/registry.ts` (one line), UI option.
- **Layers:** 2 (+ trivial Layer-4 registration).
- **Interfaces:** `ISerializer`.
- **Tests:** vault structure; wikilink + filename sanitization/collision; tags;
  attachment routing.
- **Risks:** R5 (link/filename collisions).
- **Exit criteria:** produced zip imports cleanly into Obsidian as a vault.

### M6 — Media retention policy + `MediaJanitor` (Layer 0 type + Layer 4)

- **Objective:** Implement `IMediaRetentionPolicy` handling and the alarm-driven
  `MediaJanitor` enforcing caps, LRU, the eviction invariant, and pin exemption.
  Persist policy + pinned ids; expose minimal settings UI.
- **Why / ordering:** The scaling safeguard for 100k+ resources. Independent of
  export, so it follows the export feature by priority. Must come after export
  exists so "exported" is a valid additional evictability signal. **Unlocks safe
  long-term operation.**
- **Files:** `apps/extension/src/background/media-janitor.ts`,
  composition-root wiring (register alarm), settings UI, control-state for policy +
  pins. (Thumbnail generation: **deferred**, not in this milestone.)
- **Layers:** 0 (policy type, from M1) + 4 (janitor).
- **Interfaces:** `IMediaRetentionPolicy`, `IMediaStore` (`list`/`statistics`/
  `delete`/`getMetadata`), `IStorageEngine` (resource state lookups).
- **Tests:** LRU selection; invariant (never evict non-`ENRICHED` or pinned); cap
  enforcement; idempotent cleanup; quota-pressure path.
- **Risks:** R1 (mis-eviction) — the invariant test is the gate.
- **Exit criteria:** OPFS usage stays under cap across a seeded 10k+ media set with
  zero invariant violations.

### M7 — Incremental export + download-on-demand (deferred / optional)

- **Objective:** Per-target `IExportManifest` watermark (export only new/changed);
  `embed-remote` media inclusion (re-fetch absent bytes via the authenticated
  content script, graceful fallback). Optional `EXPORTED` UX flag.
- **Why / ordering:** A scale optimization, valuable only after full export and
  retention are proven. **Unlocks nothing further; closes Beta-3.**
- **Files:** `packages/types/src/export/` (manifest type), coordinator (watermark +
  on-demand branch), content-script fetch path.
- **Layers:** 0 + 4.
- **Interfaces:** `IExportManifest`, `MediaInclusion` (add `embed-remote`).
- **Tests:** watermark diffing; on-demand success + failure-fallback; manifest
  persistence/restore.
- **Risks:** R1 (don't let on-demand mask eviction policy); auth availability.
- **Exit criteria:** re-export transfers only changed/new resources; absent bytes
  re-fetched when possible, gracefully linked when not.

---

## 14. Implementation guidance for Claude Sonnet

1. **One milestone per session.** Do not roll into the next phase without
   instruction (CLAUDE.md).
2. **Contracts first (M1), pure before orchestration (M2/M3/M5 before M4 wiring).**
   Serializers must be unit-tested from fixtures with no MV3, storage, or browser.
3. **Additive only.** Never modify `IResource`, `IStorageEngine`, `IMediaStore`, or
   `ResourceState` signatures. Reuse `IResourceQueryable` (paging) and
   `IMediaStore.lastAccess`/`statistics`/`delete` (retention) as-is.
4. **Composition root is the only wiring site** (`apps/extension/src/background/index.ts`).
   Coordinator, writer, serializer `Map`, and janitor are constructed there and
   injected; subsystems never self-construct infrastructure.
5. **MV3 discipline (M4/M6):** self-scheduling `setTimeout` + `chrome.alarms`
   watchdog + persisted cursor. No `setInterval`, no unbounded loops.
6. **Every milestone ends with tests + docs:** update `20_CURRENT_STATE.md`, this
   document if reality diverges, and `40_NEXT_TASK.md` to the next milestone. Gemini
   keeps these aligned; no architectural decisions are made during implementation —
   they all live here.

```

```
