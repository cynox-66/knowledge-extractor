# Development Guide

## Prerequisites

- Node.js ≥ 20
- pnpm 9 (`corepack enable && corepack prepare pnpm@9 --activate`)

## Setup

```bash
pnpm install
```

## Workspace commands

All commands run from the repository root via Turborepo:

| Command                 | What it does                                  |
| ----------------------- | --------------------------------------------- |
| `pnpm run build`        | Vite build for the extension                  |
| `pnpm run typecheck`    | `tsc --noEmit` across all 5 packages          |
| `pnpm run lint`         | ESLint across all 5 packages                  |
| `pnpm run test`         | Vitest (connector fixture tests)              |
| `pnpm run depcruise`    | Architecture enforcement (dependency-cruiser) |
| `pnpm run format:check` | Prettier check                                |
| `pnpm run format`       | Prettier write                                |
| `pnpm run lint:root`    | ESLint from the root config (all files)       |

## Loading the extension

1. `pnpm run build`
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer Mode** (top right).
4. Click **Load unpacked** → select `apps/extension/dist`.
5. Navigate to `https://www.instagram.com/saved`.
6. Click the extension icon to open the popup.

## Development cycle

```bash
# Terminal 1: watch build
cd apps/extension && pnpm run dev

# After saving changes:
# - Chrome auto-reloads the extension if using @crxjs/vite-plugin
# - Or manually click the reload icon on chrome://extensions
```

## Debugging

### Background service worker

1. Open `chrome://extensions`.
2. Click **Inspect views: service worker** under the extension.
3. The DevTools console shows all `Logger` output from `CrawlController`,
   `Scheduler`, `SessionManager`, etc.
4. Use `chrome.storage.session.get(null)` in the console to inspect persisted
   session and queue state.

### Content script

1. Open DevTools on the Instagram tab (`F12`).
2. The console shows `Logger` output from `ContentScript`, `Navigator`,
   `DiscoveryEngine`.

### Popup

1. Right-click the popup → **Inspect**.
2. React DevTools work here if installed.

## Diagnostics export

1. Open the popup while a crawl is running or after it finishes.
2. Click **Export Diagnostics**.
3. A JSON file is downloaded containing the full `ISessionReport`:
   metrics, failures (with DOM snapshots), and strategy usage.

## Architecture enforcement

```bash
pnpm run depcruise
```

This validates all import paths against the layer rules in
`.dependency-cruiser.js`. Any violation fails CI.

## Adding a package

1. Create the directory under `packages/`, `connectors/`, or `apps/`.
2. Add a `package.json` with `typecheck` and `lint` scripts.
3. Add a `tsconfig.json` extending `../../tsconfig.base.json`.
4. Add a reference in the root `tsconfig.json`.
5. Run `pnpm install` to link the workspace.
