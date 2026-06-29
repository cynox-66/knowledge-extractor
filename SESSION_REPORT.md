# SESSION REPORT — Beta-3 Milestones M2 + M3

**Date:** 2026-06-29
**Milestones:** M2 (ResourceProjector + JSON/NDJSON Serializer) + M3 (Markdown Serializer)
**Session status:** COMPLETE

---

## Summary

Implemented `packages/export` as the new Layer 2 pure transformation package.
M2 delivered the core projector and NDJSON serializer; M3 added the Markdown
serializer and the shared block renderer (reused by ObsidianSerializer in M5).
All components are storage-free, browser-free, and independently testable from fixtures.

---

## Files Changed

### New files

| File                                                | Purpose                                                        |
| --------------------------------------------------- | -------------------------------------------------------------- |
| `packages/export/package.json`                      | Package manifest; depends on `@knowledge-extractor/types` only |
| `packages/export/tsconfig.json`                     | Extends base config; includes src + tests                      |
| `packages/export/vitest.config.ts`                  | Node environment, no setup files                               |
| `packages/export/src/projector.ts`                  | Pure `project()` function (IResource → IExportItem)            |
| `packages/export/src/json-serializer.ts`            | `JsonSerializer` (NDJSON) + `NDJSON_OUTPUT_PATH`               |
| `packages/export/src/block-renderer.ts`             | `renderBlock()` — shared block→Markdown renderer               |
| `packages/export/src/markdown-serializer.ts`        | `MarkdownSerializer` — one .md per resource                    |
| `packages/export/src/index.ts`                      | Barrel export                                                  |
| `packages/export/tests/fixtures.ts`                 | Shared `makeResource()` test fixture                           |
| `packages/export/tests/projector.test.ts`           | 21 projector unit tests                                        |
| `packages/export/tests/json-serializer.test.ts`     | 15 JSON/NDJSON serializer tests                                |
| `packages/export/tests/block-renderer.test.ts`      | 8 block renderer tests                                         |
| `packages/export/tests/markdown-serializer.test.ts` | 31 Markdown serializer tests                                   |

### Modified files

| File                     | Change                                                                     |
| ------------------------ | -------------------------------------------------------------------------- |
| `.dependency-cruiser.js` | Added `export-and-storage-isolated` + `storage-cannot-import-export` rules |

---

## Design Decisions

### ResourceProjector

- Pure function (not a class). No state, no side effects.
- Caller (Layer-4 ExportCoordinator) supplies `presentMediaIds` from `IMediaStore.exists()`.
- `localPath` scheme: `media/{mediaId}` — deterministic, extension-free.
- Optional properties use conditional spread to satisfy `exactOptionalPropertyTypes`.
- Frontmatter captures: `sourceUrl`, `providerName`, `externalId`, `extractedAt`, `author`, `sourceMetadata`. Excludes internal lifecycle fields (`state`, `completeness`).
- Recursively projects children, propagating the same presence set and inclusion policy.

### JsonSerializer (NDJSON)

- Each `serializeItem` call returns one text `IExportPart` with `path: 'export.ndjson'`.
- Text parts sharing the same path are appended in stream order (writer semantics).
- Memory bounded to one item at a time; no `finalize()` required for NDJSON.
- `NDJSON_OUTPUT_PATH` constant exported for writer and test use.

### Block Renderer (`src/block-renderer.ts`)

- Exhaustive `switch` over `BlockType` — TypeScript enforces total coverage.
- Extracted as a standalone module so `MarkdownSerializer` and the future `ObsidianSerializer` (M5) both import it without duplication.
- Rendering choices: TEXT→plain, HEADING→`##`, QUOTE→`>`, CODE→fenced, LIST_ITEM→`-`, TRANSCRIPT→`**[Transcript]**\n\n{value}`.

### MarkdownSerializer

- One `.md` text part per resource (`{resourceId}.md`) — "one note per resource" per spec.
- YAML frontmatter: simple key: value serialization; strings with YAML-special chars are double-quoted; nested objects use inline JSON (valid YAML superset), no library dependency.
- Body blocks joined with `\n\n` (markdown paragraph separation).
- Media section: `![{type}]({localPath or sourceUri})` per ref; absent media falls back to `sourceUri`.
- Binary parts: one `{ kind: 'binary', path: media.localPath, mediaId }` per present blob — the Layer-4 writer resolves bytes from `IMediaStore`.
- Children: `serializeItem` recurses into children, producing separate `.md` files.

### Dependency-cruiser rules

- `export-and-storage-isolated`: `packages/export` → `packages/storage` (forbidden).
- `storage-cannot-import-export`: `packages/storage` → `packages/export` (forbidden).

---

## Tests Added

**`tests/projector.test.ts` — 21 tests:**
IResource→IExportItem mapping, frontmatter fields, author inclusion/exclusion, media ref resolution (present/absent/mixed, inclusion modes), deterministic localPath, children projection, purity.

**`tests/json-serializer.test.ts` — 15 tests:**
Target enum, part count/path/kind, valid JSON line with newline, round-trip equivalence, NDJSON multi-item concat, shared path, determinism, purity.

**`tests/block-renderer.test.ts` — 8 tests:**
All 6 BlockType variants rendered correctly, determinism, input immutability.

**`tests/markdown-serializer.test.ts` — 31 tests:**
Target enum, text part path/structure, YAML frontmatter fields, all 6 block types in body, multi-block separation, empty body, media links (localPath vs sourceUri vs none), binary part generation, children (.md per child), purity, determinism.

---

## Gate Results

| Gate        | Result | Detail                                                        |
| ----------- | ------ | ------------------------------------------------------------- |
| `typecheck` | PASS   | 6 packages, 0 errors                                          |
| `lint`      | PASS   | 6 packages, 0 errors                                          |
| `test`      | PASS   | 75 new tests in packages/export; all pre-existing tests green |
| `depcruise` | PASS   | 118 modules, 179 dependencies, 0 violations                   |
| `build`     | PASS   | Extension build cached clean                                  |

Pre-existing test counts (unchanged): storage 18, instagram 8, extension 82.

---

## Known Limitations

1. **`localPath` has no file extension.** `media/{mediaId}` is deterministic but not human-friendly. The ExportWriter (M4) can suffix an extension from detected MIME type when writing.
2. **YAML frontmatter is minimal.** Nested objects serialize as inline JSON strings, not idiomatic YAML. Sufficient for machine consumption; a YAML library could be added in M5 (Obsidian) if human readability is required.
3. **No filename sanitization.** `{resourceId}.md` path uses the resourceId as-is. Obsidian (M5) requires sanitized filenames (R5); a `sanitizePath()` helper should be extracted in M5 and shared.
4. **No `build` script.** Consistent with `packages/types` and `packages/shared`.

---

## Next Milestone: M4

**Export Orchestration End-to-End (Layer 4)**

- `ExportCoordinator`: MV3-safe tick loop over `IResourceQueryable`, builds presence maps from `IMediaStore`, drives projector + serializer, persists `IExportProgress` for resumability.
- `ExportWriter`: ZIP assembly (markdown) + single-file (NDJSON), `chrome.downloads` trigger.
- Serializer registry `Map<ExportTarget, ISerializer>` in the composition root.
- Composition-root wiring in `apps/extension/src/background/index.ts`.
- Export control in popup/options UI.
- `manifest.json`: confirm `downloads` permission.
- Tests: coordinator paging + resume-from-cursor (fake storage), writer assembly, end-to-end on seeded store.
