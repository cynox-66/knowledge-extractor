# Architectural Dependency Graph

This document serves as the strict architectural contract for the Knowledge Extractor monorepo. It defines the allowed dependency flows between packages to prevent tight coupling, circular dependencies, and architectural degradation over time.

These rules will be programmatically enforced in CI using `dependency-cruiser`.

---

## 1. System Layers

The repository is structured into hierarchical layers. A package in Layer N may only import from packages in Layer < N. Sibling dependencies are strictly regulated.

### Layer 0: Primitives

The absolute foundation. These packages contain no business logic and cannot import from any other package in the monorepo.

- **`@knowledge-extractor/types`** (`packages/types`)
  - **Purpose**: Shared TypeScript interfaces, types, and generic data models (e.g., `NormalizedDocument`).
  - **Allowed Imports**: None.

### Layer 1: Core Utilities

Shared functionality used across the entire platform.

- **`@knowledge-extractor/shared`** (`packages/shared`)
  - **Purpose**: Cross-cutting concerns like logging, configuration, error classes, and constants.
  - **Allowed Imports**: `types`
- **`@knowledge-extractor/utils`** (`packages/utils`)
  - **Purpose**: Pure functions, generic data parsing, and string manipulation.
  - **Allowed Imports**: `types`

### Layer 2: Platform Engines

Independent subsystems that perform specific knowledge platform operations. These engines must not depend on each other unless explicitly passing data through generic interfaces.

- **`@knowledge-extractor/extractor`** (`packages/extractor`)
  - **Purpose**: Validation and normalization pipelines.
  - **Allowed Imports**: `types`, `shared`, `utils`
- **`@knowledge-extractor/storage`** (`packages/storage`)
  - **Purpose**: Local persistence (IndexedDB, etc.).
  - **Allowed Imports**: `types`, `shared`
- **`@knowledge-extractor/exporters`** (`packages/exporters`)
  - **Purpose**: Exporting data to JSON, Markdown, CSV.
  - **Allowed Imports**: `types`, `shared`, `utils`
- **`@knowledge-extractor/ocr`** (`packages/ocr`)
  - **Purpose**: Text extraction from images/frames.
  - **Allowed Imports**: `types`, `shared`
- **`@knowledge-extractor/ai`** (`packages/ai`)
  - **Purpose**: External LLM integrations and prompt building.
  - **Allowed Imports**: `types`, `shared`

### Layer 3: Domain Connectors

Source-specific extraction implementations.

- **`@knowledge-extractor/connector-*`** (`connectors/*`)
  - **Purpose**: Transforming source data (e.g., Instagram DOM) into `NormalizedDocument` objects.
  - **Allowed Imports**: `types`, `shared`, `utils`
  - **Forbidden Imports**: Other connectors, Platform Engines (`storage`, `extractor`, etc.), Apps.

### Layer 4: Applications (Composition Roots)

The entry points that wire the platform together.

- **`@knowledge-extractor/extension`** (`apps/extension`)
  - **Purpose**: Browser extension UI and Background Worker orchestration.
  - **Allowed Imports**: `types`, `shared`, `utils`, `extractor`, `storage`, `exporters`, `connectors/*`

---

## 2. Forbidden Imports & Strict Rules

To maintain the modular philosophy, the following rules are non-negotiable:

1.  **No Upward Dependencies**: A package can never import from a layer above it. (e.g., `packages/types` cannot import `packages/shared`).
2.  **No Connector Cross-Pollination**: `connectors/instagram` cannot import from `connectors/linkedin`. If logic is shared, it must be abstracted into `packages/utils` or `packages/shared`.
3.  **No App Dependencies**: Absolutely no package or connector may import from `apps/*`. The application layer is strictly a consumer.
4.  **No UI in Packages**: Business logic packages (`storage`, `extractor`) must not import UI libraries (React, Vue) or browser-specific rendering code.
5.  **No Engine Entanglement**: `packages/exporters` must not depend on `packages/storage`. They communicate implicitly because the App layer orchestrates passing data from Storage to the Exporter via the generic `types`.

---

## 3. Future Expansion Strategy

As new connectors (Reddit, X, YouTube) are added:

1.  They will be created as new independent packages in the `connectors/` directory.
2.  They will implement the standard `IConnector` interface defined in `packages/types`.
3.  They will be wired into the Background Worker inside `apps/extension`.
4.  No changes should be required in `packages/extractor` or `packages/storage` to support a new connector.

When the platform matures and internal APIs stabilize, we will utilize **API Extractor** to generate `.d.ts` rollups and enforce public API contracts for `packages/types` and `packages/shared`.

---

## 4. Validation

These rules are translated into code via `dependency-cruiser` in `.dependency-cruiser.js` at the root of the monorepo. The CI pipeline will fail if any of these architectural boundaries are violated.
