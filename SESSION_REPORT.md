# Session Report — Beta-3 Milestone M6: Media Retention Policy + MediaJanitor

**Date:** 2026-06-29  
**Milestone:** M6 (Beta-3)  
**Status:** Complete

---

## Implementation Summary

Implemented the alarm-driven `MediaJanitor` (Layer 4) that enforces `IMediaRetentionPolicy`
over `IMediaStore`. The janitor is the only component that deletes media for capacity reasons.
`IMediaRetentionPolicy` was already defined in `packages/types/src/storage/retention.ts` (M1).

---

## Files Changed

| File                                             | Change                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| `apps/extension/src/background/media-janitor.ts` | **NEW** — `MediaJanitor` class + `IJanitorReport`                  |
| `apps/extension/src/background/index.ts`         | **MODIFIED** — import, construction, startup wiring, alarm handler |
| `apps/extension/tests/media-janitor.test.ts`     | **NEW** — 30 comprehensive tests                                   |

---

## Runtime Flow

```
startup()
  └─ mediaJanitor.schedule(30)
       └─ chrome.alarms.create('media-janitor', { delayInMinutes: 30 })

chrome.alarms.onAlarm → 'media-janitor'
  └─ mediaJanitor.handleAlarm()
       └─ _trigger()  [no-op if _passInProgress]
            └─ runPass()
                 1. policy.fullMediaMode === 'keep' → return immediately
                 2. statistics() → if totalBytes ≤ maxCacheBytes → return (skippedUnderCap)
                 3. Build eligibleMedia Map<mediaId, resourceId>
                    ├─ query all ENRICHED resources, collect media ids
                    └─ query all EXPORTED resources, collect media ids
                 4. Load pinnedResourceIds from controlStore['pinned_resource_ids']
                 5. list() all media, sort by lastAccess ASC (LRU: oldest first)
                 6. Evict in order until bytesFreed ≥ bytesToFree:
                    ├─ skip if retainVideo && type === VIDEO
                    ├─ skip if mediaId not in eligibleMedia (parent not ENRICHED/EXPORTED)
                    ├─ skip if resourceId is in pinnedResourceIds
                    └─ delete(mediaId), accumulate bytesFreed; yield every 50 evictions
            └─ chrome.alarms.create('media-janitor', ...) [reschedule always]
```

---

## Retention Strategy

- **Policy type:** `IMediaRetentionPolicy` (Layer 0, defined in M1)
- **Default production policy:** `fullMediaMode: 'cache'`, `maxCacheBytes: 500 MB`, `retainVideo: false`
- **`fullMediaMode: 'keep'`:** no eviction of any kind; pass returns immediately
- **`fullMediaMode: 'cache'`:** LRU eviction above `maxCacheBytes` cap
- **`retainVideo: true`:** video blobs exempt from eviction; images/audio/documents still eligible
- **Pinned resources:** exempt from eviction; pin set stored in `IControlStateStore` under key `'pinned_resource_ids'` as `string[]`

---

## Eviction Flow

1. **Statistics gate:** if `totalBytes ≤ maxCacheBytes`, pass exits cleanly. No reads, no deletes.
2. **Eligible set construction:** enumerate ENRICHED and EXPORTED resources via `IResourceQueryable`. Build `Map<mediaId, resourceId>`. Any blob whose mediaId is absent is automatically ineligible — the invariant is enforced structurally.
3. **LRU sort:** `IMediaMetadata.lastAccess` (ISO 8601) compared lexicographically. Oldest access = first to evict.
4. **Per-blob checks (in order):** video retention → eligibility invariant → pinned check.
5. **Per-item isolation:** a single `IMediaStore.delete()` failure logs a warning and continues; the pass does not abort.
6. **Yield:** every 50 successful deletions, `yieldToEventLoop()` (`setTimeout(0)`) releases the event loop.
7. **Reschedule:** `chrome.alarms.create()` is called in both the success and catch path of `_trigger()` — the janitor can never permanently stop.

---

## Architectural Invariants Preserved

| Invariant                                 | Preservation                                                                                               |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Knowledge is permanent**                | `MediaJanitor` only calls `IMediaStore.delete()` — `IResource` records never touched                       |
| **Media is policy-managed**               | All eviction gated through `IMediaRetentionPolicy`                                                         |
| **Eviction only after ENRICHED/EXPORTED** | Eligible set built exclusively from ENRICHED+EXPORTED resources; any other state → structurally ineligible |
| **Pinned media exempt**                   | Checked against `pinnedResourceIds` before every deletion                                                  |
| **No `setInterval`; no unbounded loops**  | `chrome.alarms` + single bounded pass per activation                                                       |
| **Additive only**                         | No modifications to `IResource`, `IStorageEngine`, `IMediaStore`, `ResourceState`                          |
| **Composition root wiring**               | `MediaJanitor` constructed and scheduled only in `index.ts`                                                |
| **Layer isolation**                       | `media-janitor.ts` imports only `@knowledge-extractor/types` + `@knowledge-extractor/shared`               |

---

## Tests Added

**File:** `apps/extension/tests/media-janitor.test.ts` (30 tests, all passing)

| Suite                 | Tests                                                                                               |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| `policy=keep`         | no-op pass; storage never queried                                                                   |
| `cache under cap`     | skippedUnderCap=true; exact boundary                                                                |
| `LRU ordering`        | oldest evicted first; multiple evictions; stops when freed                                          |
| `eviction invariant`  | DISCOVERED/EXTRACTED/HYDRATED skipped; ENRICHED/EXPORTED evicted; mixed                             |
| `pinned resources`    | pinned skipped; non-pinned evicted alongside pinned; empty pin list                                 |
| `video retention`     | video skipped when retainVideo=true; evicted when false; images still evicted with retainVideo=true |
| `storage failures`    | statistics() throws; queryResources throws; per-item delete failure isolated                        |
| `statistics`          | totalBytesBeforeEviction; totalBytesAfterEviction; bytesFreed accounting                            |
| `alarm scheduling`    | schedule() creates alarm; handleAlarm() reschedules; concurrent call ignored                        |
| `startup`             | ALARM_NAME is a non-empty string; works without controlStore                                        |
| `deterministic order` | identical state → identical eviction order across two passes                                        |

---

## Gate Results

| Gate             | Result                                           |
| ---------------- | ------------------------------------------------ |
| `pnpm typecheck` | ✅ 6/6 packages — no errors                      |
| `pnpm lint`      | ✅ 6/6 packages — no violations                  |
| `pnpm test`      | ✅ 152/152 tests passing (9 test files)          |
| `pnpm depcruise` | ✅ 134 modules, 226 dependencies — no violations |
| `pnpm build`     | ✅ Vite build successful                         |

---

## Known Limitations

1. **Policy is static at startup.** Hard-coded 500 MB cap in `index.ts`. A settings UI can persist `IMediaRetentionPolicy` in `IControlStateStore` and load it at startup without changing the janitor.
2. **Pinned resource set is write-only from the janitor's perspective.** The janitor reads pins; no UI yet exposes the pin action. Key: `'pinned_resource_ids': string[]`.
3. **No `PERSISTED` state in eligibility set.** Architecture spec says "ENRICHED or EXPORTED" only. If `PERSISTED` should also be eligible, adding it to the eligible states loop is a one-line change.

---

## Next Milestone

**M7 — Incremental export + download-on-demand (deferred/optional)**

- Per-target `IExportManifest` watermark (export only new/changed resources)
- `embed-remote` media inclusion (re-fetch absent bytes via content script)
- Optional `EXPORTED` UX flag
- Files: `packages/types/src/export/` (manifest type), coordinator (watermark + on-demand branch), content-script fetch path

---

## Implementation Summary

M5 adds the Obsidian vault export target to `packages/export`, wires it into the serializer registry, and exposes it in the popup UI — exactly validating the architectural claim from ADR-013: _a new export target requires one serializer plus one registry entry_.

---

## Files Changed

### New files

| File                                                | Purpose                                                              |
| --------------------------------------------------- | -------------------------------------------------------------------- |
| `packages/export/src/path-utils.ts`                 | `sanitizePath()` — filesystem-safe path sanitization (shared helper) |
| `packages/export/src/obsidian-serializer.ts`        | `ObsidianSerializer implements ISerializer` — Obsidian vault layout  |
| `packages/export/tests/obsidian-serializer.test.ts` | Comprehensive unit tests (83 test cases)                             |

### Modified files

| File                                               | Change                                                                     |
| -------------------------------------------------- | -------------------------------------------------------------------------- |
| `packages/export/src/index.ts`                     | Barrel-exports `ObsidianSerializer` and `sanitizePath`                     |
| `apps/extension/src/background/export/registry.ts` | One-line addition: `[ExportTarget.OBSIDIAN, new ObsidianSerializer()]`     |
| `apps/extension/src/popup/index.tsx`               | One `<option>` for Obsidian Vault (.zip) in the target selector            |
| `apps/extension/tests/serializer-registry.test.ts` | Updated M4 guard test (was: "OBSIDIAN absent"; now: "OBSIDIAN registered") |
| `apps/extension/tests/export-coordinator.test.ts`  | Updated M4 negative test to use an unknown string cast instead of OBSIDIAN |

---

## Runtime Flow

```
ExportCoordinator (Layer 4)
  │ coordinator.start({ target: ExportTarget.OBSIDIAN, ... })
  │ → registry.get(OBSIDIAN) → ObsidianSerializer
  │
  └─ tick loop: project(resource) → IExportItem
       │
       └─ serializer.serializeItem(item) → IExportPart[]
            │
            ├─ text part: "{kind}/{sanitizePath(resourceId)}.md"
            │    YAML frontmatter:
            │      tags: [kind, providerName]
            │      kind: ...
            │      sourceUrl/providerName/externalId/extractedAt/author
            │    Body: renderBlock() per IContentBlock (shared with MarkdownSerializer)
            │    Media: ![[attachments/mediaId]] for present blobs, ![type](uri) for remote
            │    Children: ## Children + - [[kind/sanitizedChildId]] wikilinks
            │
            └─ binary part (per locally-present blob): "attachments/{sanitizePath(mediaId)}"
                 mediaId → coordinator → IMediaStore.get() → bytes → ExportWriter
```

Vault layout in the produced ZIP:

```
{kind}/
  {sanitizePath(resourceId)}.md    ← one per resource (and per child)
attachments/
  {sanitizePath(mediaId)}          ← one per present blob
```

---

## Architectural Invariants Preserved

| Invariant                                                          | Status                          |
| ------------------------------------------------------------------ | ------------------------------- |
| `packages/export` is pure — no storage, no browser, no MV3 imports | ✓                               |
| Layer 2 (packages/export) only imports Layer 0/1                   | ✓                               |
| `export-and-storage-isolated` depcruise rule                       | ✓ green (132 modules, 220 deps) |
| ExportCoordinator, ExportWriter, ResourceProjector unchanged       | ✓                               |
| JsonSerializer, MarkdownSerializer unchanged                       | ✓                               |
| Layer 0 contracts unchanged                                        | ✓                               |
| Deterministic, idempotent output                                   | ✓                               |
| No mutation of IResource or ResourceState                          | ✓                               |
| One serializer + one registry line (ADR-013 proof)                 | ✓                               |

---

## Tests Added

`packages/export/tests/obsidian-serializer.test.ts` — 83 test cases across:

- **sanitizePath helper:** 10 cases — illegal chars, whitespace, dots, truncation, empty, determinism
- **Contract:** 3 cases — ISerializer compliance, target, newline termination
- **Vault layout:** 4 cases — note paths, kind subdirectory, sanitized ids, different resources
- **Frontmatter:** 8 cases — tags, kind, sourceUrl, providerName, author, null values, tag deduplication
- **Body blocks:** 8 cases — all BlockType variants, separator, empty body
- **Attachment paths:** 7 cases — attachments/ prefix, sanitized mediaId, mediaId for lookup, inclusion=none, no present blobs, multiple blobs, special chars
- **Media references:** 6 cases — Obsidian embed syntax, remote fallback, inclusion=none, no media, mixed
- **Wikilinks:** 6 cases — ## Children section, [[kind/id]] format, path matches ZIP entry, sanitized ids, no children, multiple children
- **Child note generation:** 3 cases — separate text part per child, child binary parts, single note without children
- **Purity & determinism:** 4 cases — identical output, no mutation, no global state, structural equality
- **Registry compatibility:** 3 cases — target value, constructable no-args, ISerializer interface shape
- **IExportPart contract:** 4 cases — text parts structure, binary parts structure, no mediaId on text, non-empty paths

---

## Gate Results

| Gate             | Result                                          |
| ---------------- | ----------------------------------------------- |
| `pnpm typecheck` | ✓ 6/6 packages pass                             |
| `pnpm lint`      | ✓ 6/6 packages pass                             |
| `pnpm test`      | ✓ 5/5 test suites, 262 tests total              |
| `pnpm depcruise` | ✓ no violations (132 modules, 220 dependencies) |
| `pnpm build`     | ✓ extension built successfully                  |

---

## Known Limitations

1. **Attachment extensions omitted** — `attachments/{mediaId}` has no file extension because `IExportMediaRef` does not carry MIME type or extension information. Obsidian can still embed files without extension (it infers type from content). A future enhancement could derive extensions from `MediaType` (image → `.jpg`, video → `.mp4`).

2. **YAML value serialization duplicated** — The private `serializeYamlValue`/`quoteYamlString` helpers in `ObsidianSerializer` are identical to the private helpers in `MarkdownSerializer`. They could not be extracted to a shared module without modifying `MarkdownSerializer`, which was out of scope. A future refactor could extract these to `yaml-utils.ts` and update both serializers.

3. **Cross-resource same-author wikilinks not implemented** — The architecture mentions "resources by the same author cross-linked". This session implements child wikilinks only. Same-author cross-linking requires a global author → resource index not available during pure per-item serialization; it would need a two-pass approach outside the `ISerializer` contract.

---

## Next Milestone

**M6 — Media Retention Policy + MediaJanitor (Layer 0 type + Layer 4)**

Implement `IMediaRetentionPolicy` handling and the alarm-driven `MediaJanitor` that enforces LRU eviction caps, the eviction invariant (only post-ENRICHED, non-pinned), and pin exemption. This is the scaling safeguard for 100k+ resources.
