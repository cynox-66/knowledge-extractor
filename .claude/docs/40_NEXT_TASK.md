# Next Task

## Current Milestone
Beta-3 (Knowledge Ownership & Export) — **Milestone M6: Media Retention Policy + MediaJanitor**

## Current Objective
Implement **M6**: Enforce `IMediaRetentionPolicy` to manage storage usage at scale via an alarm-driven `MediaJanitor`.

## Why this task exists
Until now, all extracted media blobs (images, etc.) are kept indefinitely. For long-running extractions (10k+ resources), this will exhaust extension storage quotas. We must enforce a retention policy (e.g., LRU cache limits) to evict media safely.

## Pre-conditions (must be verified at session start)
1. Beta-3 Milestone M5 (Obsidian Export Target) is complete.
2. `IMediaRetentionPolicy` is defined in `packages/types/src/storage/retention.ts`.

## Scope — Milestone M6

### MediaJanitor (Layer 4)
- Implement `MediaJanitor` as an MV3-safe background worker process (alarm-driven).
- **Eviction Logic:** 
  - Never evict resources that are not yet `ENRICHED` (preserves data for the OCR loop).
  - Never evict pinned/favorite resources (if the model supports it).
  - Enforce `maxCacheBytes` limit (from `IMediaRetentionPolicy`) using an LRU eviction strategy based on access time or extraction time.
  - Do not evict metadata (`IResource`); only evict the raw binary blobs from `IMediaStore`.

### Runtime Integration
- Integrate `MediaJanitor` into the background worker orchestration (`apps/extension/src/background/index.ts`).
- Schedule the janitor alarm to run periodically.

## Constraints
- Safe interaction with the `EnrichmentLoop`: ensure no race conditions where media is deleted just before OCR processes it.
- Yield to the event loop during large janitor sweeps to avoid SW termination.

## Files Expected to Change
- `apps/extension/src/background/media-janitor.ts` (New)
- `apps/extension/src/background/index.ts` (Wiring)
- Relevant tests

## Risks
- Storage quota errors during large sweeps if OPFS/IndexedDB metrics are inaccurate.
- Race conditions with ongoing exports or enrichment.

## Exit Criteria
- `MediaJanitor` correctly evicts older media blobs while respecting the `IMediaRetentionPolicy` bounds.
- In-progress `ENRICHED` resources are safely bypassed.
- Full unit test coverage for the janitor logic.
