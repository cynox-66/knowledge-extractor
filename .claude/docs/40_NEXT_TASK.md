# Next Task

## Current Milestone
Beta-3 (Knowledge Ownership & Export) — **Milestone M2: `packages/export` + JSON Serializer**

## Current Objective
Implement **M2**: Stand up the new `packages/export` workspace package, implement the resource projector, and build the JSON/NDJSON serializer.

## Why this task exists
With the M1 export contracts finalized in `packages/types`, the next step (Layer 2) is to implement the pure transformation logic that converts an internal `IResource` into format-agnostic `IExportItem`s and subsequently serializes them to text/binary parts.

## Pre-conditions (must be verified at session start)
1. Beta-3 Milestone M1 (Export Contracts) is complete and merged.
2. `packages/types/src/export/exporter.ts` contains the canonical `IExportItem`, `ISerializer`, and `ExportTarget` contracts.

## Scope — Milestone M2
- **New Package:** Create `packages/export` and configure it in the monorepo workspace.
- **Projector:** Implement a pure function `project(resource, presentMediaIds, inclusion): IExportItem`.
- **JSON Serializer:** Implement `JsonSerializer` (NDJSON format, one resource per line).
- **Enforcement:** Add `export-and-storage-isolated` rule to dependency-cruiser to ensure Layer 2 purity.
- **Tests:** Add unit tests for the projector (media-path assignment, formatting) and the serializer (NDJSON string output).

## Constraints
- Pure logic only: no actual file writing or storage/MV3 APIs in this milestone.
- Dependency isolation: `packages/export` must not depend on `packages/storage` or extension APIs.

## Files Expected to Change
- `packages/export/*` (new package structure)
- `.dependency-cruiser.js` (rule addition)

## Risks
- Incorrect typing or imports leaking domain logic into the serialization layer.

## Exit Criteria
- `packages/export` builds cleanly and passes all local unit tests.
- `dependency-cruiser` enforces isolation rules.
- JSON/NDJSON string output behaves as expected in tests.
