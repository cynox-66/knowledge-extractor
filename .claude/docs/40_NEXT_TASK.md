# Next Task

## Current Milestone
Beta-3 (Knowledge Ownership & Export) — **Milestone M4: Export Orchestration End-to-End**

## Current Objective
Implement **M4**: Build the `ExportCoordinator` and `ExportWriter` to orchestrate the export process within the background worker (Layer 4).

## Why this task exists
The pure projection and serialization logic (Layer 2) was completed in M2 and M3. Now we need to orchestrate the actual data flow: querying resources from storage, resolving media presence, running the serializers, persisting progress, and generating the final download artifact.

## Pre-conditions (must be verified at session start)
1. Beta-3 Milestones M2 and M3 are complete and verified.
2. `packages/export` provides `ResourceProjector`, `JsonSerializer`, and `MarkdownSerializer` as pure, storage-isolated functions.

## Scope — Milestone M4
- **ExportCoordinator:** Implement an MV3-safe tick loop over `IResourceQueryable`, building presence maps from `IMediaStore`, driving the projector and serializers, and persisting `IExportProgress` for resumability.
- **ExportWriter:** Implement ZIP assembly for Markdown and single-file assembly for NDJSON, triggering `chrome.downloads`.
- **Wiring:** Integrate a serializer registry (`Map<ExportTarget, ISerializer>`) and wire up the coordinator in the composition root (`apps/extension/src/background/index.ts`).
- **UI & Manifest:** Add export control in the popup/options UI and ensure `downloads` permission is specified in `manifest.json`.

## Constraints
- MV3-safe execution: yield to the event loop appropriately and use cursor checkpointing.
- The coordinator must not violate the purity of `packages/export`.

## Files Expected to Change
- `apps/extension/src/background/export-coordinator.ts` (New)
- `apps/extension/src/background/export-writer.ts` (New)
- `apps/extension/src/background/index.ts` (Wiring)
- `apps/extension/manifest.json` (Permissions)
- Relevant tests

## Risks
- MV3 suspension during large exports requires careful checkpointing.
- Memory constraints when generating large ZIP files in the background worker.

## Exit Criteria
- `ExportCoordinator` successfully completes test runs with mocked storage.
- Full end-to-end export works, generating valid NDJSON and ZIP (Markdown) files via the browser's download API.
- All new orchestrator logic has test coverage.
