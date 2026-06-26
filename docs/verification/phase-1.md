# Phase 1 — Repository Stabilization & Extraction Unification (A0 + A1)

> Completed and committed as `b448a71`. Branch: `alpha/phase-1-stabilization`.

## A0 — Repository stabilization

- Removed all macOS duplicate artifacts (`* 2.*`, `* 3.*`) — 45+ files.
- Removed leftover codemod scripts (`fix-exports.js`, `fix-all-imports.js`).
- Removed empty stub packages (`ai`, `exporters`, `extractor`, `ocr`, `utils`)
  and empty legacy connector dirs (`extractors/`, `models/`, `selectors/`,
  `pipeline/`). Updated root `tsconfig.json` references.
- Added `typecheck` and `lint` scripts to all 5 packages so the full workspace
  participates in CI (was 1/10 typecheck, 0/10 lint).
- Fixed latent extension typecheck errors surfaced by full coverage.
- Added `.prettierignore`; hardened `eslint.config.mjs` ignores.

## A1 — Extraction unification

- Content Script is now a pure DOM adapter (locates `<article>`, delegates to
  `connector.extract()`). Inline parsing deleted.
- Instagram-specific types (`IInstagramParsedPost`, `InstagramPostLayout`) moved
  from `packages/types` into `connectors/instagram/src/types.ts`.
- Duplicate `IConnector` interfaces collapsed into one canonical generic
  `IConnector<TRaw>`. `InstagramConnector` implements it with `canHandle()`.
- All `any` escape hatches removed from connector source and tests.

## Exit criteria (all met)

| Gate                                   | Result              |
| -------------------------------------- | ------------------- |
| `pnpm run build`                       | PASS                |
| `pnpm run typecheck` (5/5 packages)    | PASS                |
| `pnpm run lint` (5/5 packages)         | PASS                |
| `pnpm run test` (4/4 tests)            | PASS                |
| `pnpm run depcruise`                   | PASS (0 violations) |
| `pnpm run format:check`                | PASS                |
| No Instagram types in `packages/types` | Verified            |
| No extraction logic in content script  | Verified            |
| One `IConnector` export                | Verified            |
| Zero `any` in connector src            | Verified            |
