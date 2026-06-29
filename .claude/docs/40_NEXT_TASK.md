# Next Task

## Current Milestone
Beta-3 (Knowledge Ownership & Export) — **Milestone M7: Incremental export + download-on-demand**

## Current Objective
Implement **M7**: Enable incremental exports via manifests and dynamic media re-fetching.

## Why this task exists
Currently, exports dump the entire database and rely on media being present locally. For users with large databases or aggressive media eviction policies, we need to export only the delta (new/changed resources) and be able to re-fetch evicted media on-demand during export.

## Pre-conditions (must be verified at session start)
1. Beta-3 Milestone M6 (Media Retention Policy + MediaJanitor) is complete.

## Scope — Milestone M7

### Incremental Export (Layer 4)
- Introduce `IExportManifest` to track high-water marks (e.g., `lastExportedAt`) per export target.
- Update `ExportCoordinator` to query and filter resources based on the manifest, only processing resources that changed since the last export.

### Download-on-Demand (Layer 4 & Content Script)
- When exporting a resource whose media blob has been evicted, dispatch a request to a content script (or background fetch) to retrieve the bytes dynamically.
- Update `ExportCoordinator`/`ExportWriter` to wait for and include these bytes in the final ZIP artifact.

### UI Integration
- Expose the incremental export option in the Export panel.
- Optionally expose an `EXPORTED` state flag for UX visibility.

## Constraints
- Re-fetching must be robust against network failures and unavailable sources.
- Incremental state must be stored durably (e.g., in `IControlStateStore`).
- The `packages/export` layer must remain pure; dynamic fetching happens strictly in Layer 4 orchestration before or during writing.

## Files Expected to Change
- `packages/types/src/export/` (New manifest interfaces)
- `apps/extension/src/background/export/coordinator.ts`
- Content script fetch paths
- Associated test suites

## Risks
- Re-fetching media may trigger rate limits or fail if the original site changed/removed the asset.
- Complexity in async coordination between the `ExportCoordinator` and content scripts.

## Exit Criteria
- `ExportCoordinator` can perform an incremental export yielding only delta changes.
- Evicted media can be dynamically re-fetched and included in the export artifact.
- All existing architectural invariants are preserved.
