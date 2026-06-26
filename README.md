# Knowledge Extractor

A modular browser-based platform for extracting structured knowledge from web
sources into a normalized, portable format. Instagram Saved Posts is the first
supported source; the architecture supports additional connectors without
modifying the core engine.

## Motivation

Useful information is trapped inside social media platforms, videos, screenshots,
and PDFs. Knowledge Extractor transforms it into structured, searchable,
AI-ready data that belongs to the user. It extracts and normalizes — it does not
automate engagement, circumvent access controls, or replace official APIs.

## Architecture overview

The system is a layered monorepo built around a single normalized domain model
(`IResource`). Every source is handled by an isolated **connector** that
discovers, extracts, and normalizes content. The platform engine provides
storage, scheduling, diagnostics, and export — all source-agnostic.

```
Content Script (DOM Adapter)
  → Navigator (browser manipulation)
  → Connector.extract (StrategyChain → Parser)
  → Connector.normalize (→ IResource)
  → CrawlController (orchestration)
  → Scheduler (queue, retry, backoff)
  → Storage (InMemoryStorage)
  → MetricsCollector + DiagnosticsCollector
  → Popup (stateless monitoring dashboard)
```

See [docs/architecture/ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) for
the full architecture reference with diagrams.

## Repository layout

```
packages/
  types/        Layer 0 — interfaces, domain model, contracts
  shared/       Layer 1 — logging, metrics, diagnostics, feature flags
  storage/      Layer 2 — storage abstraction + InMemoryStorage

connectors/
  instagram/    Instagram connector (implemented — Alpha)
  reddit/       Planned (placeholder)
  linkedin/     Planned (placeholder)
  youtube/      Planned (placeholder)
  x/            Planned (placeholder)
  pdf/          Planned (placeholder)
  web/          Planned (placeholder)

apps/
  extension/    Chrome MV3 extension (background, content, popup)
  desktop/      Planned (placeholder)

docs/
  architecture/ ARCHITECTURE.md, PIPELINE.md, CONNECTOR_SYSTEM.md, STORAGE.md
  guides/       CONNECTOR_GUIDE.md, CONTRIBUTING.md, DEVELOPMENT.md, TESTING.md
  verification/ Alpha report, phase walkthroughs, navigation evaluation
  rfc/          RFC-0001 (Alpha Stabilization)
  archive/      Superseded historical documents
```

## Current status

**Stage: Alpha Validation (pending live run)**

Completed engineering work:

- Monorepo infrastructure (pnpm, Turborepo, ESLint, Prettier, dependency-cruiser, Husky)
- Domain contracts and normalized resource model
- Instagram connector with three-strategy extraction chain
- Chrome MV3 extension with MV3-safe orchestration
- Queue/session persistence across service-worker restarts
- Automatic infinite-scroll with end-of-feed termination
- Full diagnostics and metrics wiring
- Stateless popup dashboard with Export Diagnostics

All CI gates pass: build, typecheck, lint, test, depcruise, format.

## Getting started

```bash
# Prerequisites: Node.js ≥20, pnpm 9
pnpm install
pnpm run build

# Load the extension in Chrome
# 1. Open chrome://extensions
# 2. Enable Developer Mode
# 3. Click "Load unpacked" → select apps/extension/dist
# 4. Navigate to instagram.com/saved
# 5. Click the extension popup → Start
```

See [docs/guides/DEVELOPMENT.md](docs/guides/DEVELOPMENT.md) for the full
development workflow.

## Development

```bash
pnpm run typecheck    # TypeScript across all packages
pnpm run lint         # ESLint across all packages
pnpm run test         # Vitest (connector fixtures)
pnpm run build        # Vite build (extension)
pnpm run depcruise    # Architecture enforcement
pnpm run format:check # Prettier
```

## Alpha roadmap

See [ROADMAP.md](ROADMAP.md) for the full Alpha → Beta → v1 roadmap.

The immediate priority is **Alpha Validation**: running the crawler against a
real Instagram Saved collection, populating the
[Alpha Report](docs/verification/alpha-report.md) with measured values, and
fixing bugs until the exit criteria are met. No Beta features begin until Alpha
is validated.

## Current limitations

- Only Instagram Saved Posts is implemented (the first connector).
- Storage is in-memory only (data is lost when the extension unloads).
- No OCR, AI enrichment, or export beyond the diagnostics JSON.
- Discovery does a full-document re-scan on each mutation (quadratic on very
  large collections — RFC-0001 Sprint A4).
- The typed event/message bus is not yet enforced end-to-end (RFC-0001 P2).
