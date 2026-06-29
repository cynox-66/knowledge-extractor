# Next Task

## Current Milestone
Beta-3 (Knowledge Ownership & Export) — **Milestone M5: ObsidianSerializer**

## Current Objective
Implement **M5**: Add the Obsidian export target (`ObsidianSerializer`) to `packages/export` and wire it into the serializer registry.

## Why this task exists
M4 validated that adding a new export target is a single serializer + one registry line, with all MV3/writer/ZIP/UI machinery reused unchanged. M5 makes that claim real with the highest-differentiation target: an Obsidian-compatible vault layout with wikilinks, attachment folders, and tag frontmatter.

## Pre-conditions (must be verified at session start)
1. Beta-3 Milestone M4 (Export Orchestration End-to-End) is complete and verified.
2. `packages/export` barrel exports `JsonSerializer` and `MarkdownSerializer`.
3. `block-renderer.ts` is available and reusable (shared with M3).

## Scope — Milestone M5

### packages/export (Layer 2)
- Implement `ObsidianSerializer` (implements `ISerializer`):
  - **Vault layout:** one `.md` per resource in `{kind}/` subfolder.
  - **Attachments:** binary parts placed in `attachments/` alongside each note.
  - **`[[wikilinks]]`:** children and resources by the same author cross-linked.
  - **Tag frontmatter:** top-level `tags:` list derived from `kind` and `sourceMetadata`.
  - **Body:** reuse `renderBlock()` from `block-renderer.ts`.
  - **Path sanitization:** extract `sanitizePath()` helper (R5 from the architecture); share it with `MarkdownSerializer`.
- Export `ObsidianSerializer` from `packages/export/src/index.ts`.

### Serializer Registry (Layer 4)
- Add `[ExportTarget.OBSIDIAN, new ObsidianSerializer()]` to `createSerializerRegistry()` in `apps/extension/src/background/export/registry.ts`.

### UI
- Add `OBSIDIAN` to the popup Export panel's target selector.

## Constraints
- No new storage/MV3 imports in `packages/export`.
- Dependency-cruiser must remain green.
- `ExportWriter`, `ExportCoordinator`, and the ZIP infrastructure are reused as-is.

## Files Expected to Change
- `packages/export/src/obsidian-serializer.ts` (New)
- `packages/export/src/block-renderer.ts` (extract `sanitizePath()` if not already done)
- `packages/export/src/index.ts` (barrel export)
- `packages/export/tests/obsidian-serializer.test.ts` (New)
- `apps/extension/src/background/export/registry.ts` (one line)
- `apps/extension/src/popup/index.tsx` (UI option)

## Risks
- Path sanitization edge cases (special chars, long IDs, filesystem limits).
- Wikilink resolution may be non-trivial for large exports with cross-referencing resources.

## Exit Criteria
- `ObsidianSerializer` passes all unit tests (vault layout, wikilinks, tags, body, binary parts).
- `dependency-cruiser` remains green.
- Obsidian target available in the popup UI and end-to-end verified via the serializer registry.
- All gate suite checks pass.
