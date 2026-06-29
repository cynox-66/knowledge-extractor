# Session Report — Beta-3 / Milestone M4: Export Orchestration End-to-End

**Date:** 2026-06-29
**Milestone:** M4 (ExportCoordinator + ExportWriter + serializer registry + wiring + UI)
**Session status:** COMPLETE

> One-time Opus implementation of the highest-risk Beta-3 integration milestone.
> Architecture was frozen; this session executed it. No ADRs revisited, no
> Layer-0/2 contracts modified, no canonical documentation rewritten.

---

## 1. Implementation summary

Implemented the Layer-4 export orchestration that turns the pure projection +
serialization logic (M2/M3) into downloadable, user-owned artifacts:

- **`ExportCoordinator`** — MV3-safe, self-yielding paginated pass over
  `IResourceQueryable`. Per page it builds a media-presence set from
  `IMediaStore.exists`, drives the pure `project()` and the selected pure
  `ISerializer`, streams the resulting parts to the writer, and persists
  `IExportProgress` (cursor + counts) for UI and resumability. Owns duplicate
  protection, cancellation, a `chrome.alarms` watchdog, and resume-after-eviction.
- **`ExportWriter`** — concrete sink. Accumulates text parts by path (append
  semantics for NDJSON) and binary parts by path; **resolves binary bytes from
  `IMediaStore` at finalize time** (bytes never flow through the pure layer);
  assembles a single NDJSON file or a ZIP and hands it to the download gateway.
- **`zip-writer.ts`** — dependency-free STORE-method ZIP encoder (CRC-32 + local
  / central-directory / EOCD records). Deterministic, pure, unit-tested by
  round-tripping through a minimal in-test unzip.
- **`download-gateway.ts`** — `IDownloadGateway` seam + `ChromeDownloadGateway`
  (worker-safe base64 `data:` URL → `chrome.downloads`, since a service worker
  has no `URL.createObjectURL`).
- **`registry.ts`** — `createSerializerRegistry()` → `Map<ExportTarget, ISerializer>`
  (JSON + Markdown; Obsidian intentionally deferred to M5). The single export seam.
- **Composition-root wiring** — gateway, writer, registry, and coordinator are
  constructed only in `background/index.ts` and injected; alarm + three message
  handlers (`START_EXPORT`, `CANCEL_EXPORT`, `GET_EXPORT_PROGRESS`) registered;
  resume-on-startup added.
- **UI + manifest** — Export panel in the popup (target + media inclusion +
  progress + cancel); `downloads` permission added to `manifest.json`.

## 2. Files changed

**New (Layer 4 — `apps/extension/src/background/export/`):**

- `zip-writer.ts`
- `download-gateway.ts`
- `writer.ts`
- `registry.ts`
- `coordinator.ts`

**New tests (`apps/extension/tests/`):**

- `zip-writer.test.ts`
- `export-writer.test.ts`
- `serializer-registry.test.ts`
- `export-coordinator.test.ts`

**Modified:**

- `apps/extension/src/background/index.ts` — construct + inject export subsystem;
  alarm handler; message handlers; resume-on-startup.
- `apps/extension/src/popup/index.tsx` — `ExportPanel` component + render.
- `apps/extension/manifest.json` — added `"downloads"` permission.
- `apps/extension/package.json` — added `@knowledge-extractor/export` workspace dep.

No files in `packages/` were modified. `packages/export` remains pure.

## 3. Runtime flow

```
popup → START_EXPORT {target, state:ENRICHED, media}
   → ExportCoordinator.start()  (synchronous duplicate latch; detached run)
       per tick (page of ≤20 resources):
         IResourceQueryable.queryResources(state, pageSize, cursor)
         for each resource:
           presentIds = IMediaStore.exists(...)        ← presence map (link-local only)
           item  = project(resource, presentIds, incl) ← Layer 2, pure
           parts = serializer.serializeItem(item)       ← Layer 2, pure
           text   → ExportWriter.appendText(path,text)
           binary → ExportWriter.writeBinary(path,mediaId)
         persist IExportProgress(cursor,counts); re-arm watchdog; yield
       finalize:
         ExportWriter resolves binary bytes via IMediaStore.get
         assemble  NDJSON (single file) | ZIP (markdown)
         ChromeDownloadGateway → chrome.downloads → user owns it
       persist IExportProgress(done:true); disarm watchdog
popup polls GET_EXPORT_PROGRESS until done.
```

Resources are never mutated (ADR-013). A worker eviction is recovered by the
watchdog alarm / startup resume, which re-drives the interrupted request to a
complete artifact.

## 4. Architectural invariants preserved

| Invariant                                        | How                                                                                    |
| ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `packages/export` remains pure                   | Untouched; coordinator imports it, never the reverse. Cruiser green.                   |
| `ExportCoordinator` owns orchestration           | All paging/presence/progress/MV3 ticking lives there.                                  |
| `ExportWriter` owns writing                      | Only the writer assembles artifacts and triggers delivery.                             |
| Serializer registry only in the composition root | `createSerializerRegistry()` invoked once in `index.ts`; the `Map` lives nowhere else. |
| `ResourceProjector` / serializers remain pure    | Consumed as-is; no signature or behavior changes.                                      |
| Binary parts never access `IMediaStore`          | Parts carry only `mediaId`; the writer resolves bytes.                                 |
| `ExportWriter` resolves media bytes              | `IMediaStore.get` at finalize, with graceful skip on absence.                          |
| Progress survives MV3 suspension                 | `IExportProgress` persisted per page to `IControlStateStore`.                          |
| No duplicate / overlapping exports               | Synchronous `_activeRun` latch (set before first await).                               |
| Memory remains bounded                           | One page of resources per tick; presence via `exists`, not `get`.                      |
| Additive only                                    | No changes to `IResource`/`IStorageEngine`/`IMediaStore`/`ResourceState`.              |
| No component self-constructs infrastructure      | Gateway/writer/registry/coordinator all injected from the composition root.            |

## 5. Tests added

`apps/extension/tests/` — covering the required matrix:

- **coordinator lifecycle / end-to-end** — JSON NDJSON (one line/resource),
  Markdown ZIP, state filtering.
- **paging** — 55 resources across 3 pages, no duplicates.
- **resumability** — simulated worker eviction (fresh coordinator + persisted
  incomplete progress) → `resume()` delivers one complete artifact; no-op when
  nothing pending or already done; alarm-driven resume.
- **serializer selection** — JSON→single-file, Markdown→zip; unknown target rejected.
- **download orchestration** — writer single-file concat, zip assembly, mime/filename.
- **media resolution** — present→included; present-at-projection/absent-at-write→missing;
  `exists` never probed under inclusion `none`.
- **failure recovery** — per-item isolation (one poisoned resource, rest exported).
- **progress persistence** — done record, per-page cursor checkpoints, `getProgress`.
- **duplicate protection** — second `start()` rejected mid-run; `runExport` throws.
- **cancellation** — cancel mid-run → no delivery, persisted state cleared.
- **composition-root wiring** — watchdog arm/disarm; serializer-registry contents.
- **ZIP encoder** — CRC-32 check value, verbatim STORE round-trip, UTF-8 names,
  binary bytes, determinism.

## 6. Gate results

| Gate                | Result                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`    | ✅ pass (6/6 packages)                                                                                  |
| `pnpm lint`         | ✅ pass (6/6 packages)                                                                                  |
| `pnpm test`         | ✅ pass — extension **122 tests** (incl. all new export suites); export 4 files, storage 3, instagram 1 |
| `pnpm depcruise`    | ✅ pass — no violations (129 modules); export↔storage isolation intact                                  |
| `pnpm build`        | ✅ pass — extension bundles, manifest emitted                                                           |
| `pnpm format:check` | ✅ pass (bonus)                                                                                         |

## 7. Known limitations

- **Whole-artifact in-memory assembly.** The NDJSON string / ZIP archive is built
  in memory before download (architecture risk R3). Bounded per-tick heap is
  preserved (one page at a time), but the final artifact size is the ceiling.
  A streaming sink can replace `ExportWriter`/`zip-writer` behind their seams.
- **Resume re-runs rather than byte-resumes.** `IExportProgress.cursor` is
  persisted per page (contract + UI + M7 seam), but because the in-memory bundle
  does not survive a hard worker eviction, `resume()` re-drives the export from
  the start of the dataset to guarantee a complete (never truncated) artifact.
  This is safe and non-duplicating (export is read-only/idempotent; the
  interrupted attempt never delivered).
- **STORE-only ZIP (no compression).** Deterministic and dependency-free; markdown
  bundles are uncompressed. Compression is a drop-in future change.
- **Download via base64 data URL.** Worker-safe but encodes the artifact in memory;
  acceptable for M4, flagged for the streaming follow-up.
- Pre-existing tesseract asset warnings during build are unrelated to M4.

## 8. Next milestone (M5)

**Obsidian target** (`ObsidianSerializer`): vault layout, `attachments/`,
`[[wikilinks]]` (carousel children / same author), tag frontmatter — reusing M3's
markdown body renderer. Wiring is a single new line in `createSerializerRegistry()`
plus one UI option, validating the "new target = one serializer + one Map entry"
claim. The MV3 + writer + ZIP + UI machinery built in M4 is reused unchanged.
M5 is unblocked by this milestone.
