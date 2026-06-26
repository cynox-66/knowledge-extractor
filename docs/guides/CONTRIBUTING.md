# Contributing

## Development workflow

1. Create a feature branch from `main`.
2. Make changes; ensure all gates pass locally before pushing.
3. Open a pull request. CI runs: commitlint, depcruise, format, lint, typecheck, test, build.
4. Merge after review.

## Branching

- `main` — stable. All CI gates must pass.
- `alpha/*` — Alpha stabilization work.
- Feature branches — short-lived, named descriptively.

## Commit conventions

Commits follow [Conventional Commits](https://www.conventionalcommits.org/)
enforced by `commitlint`. The subject must be lowercase.

```
feat(connector): add reddit discovery engine
fix(crawler): handle modal timeout during extraction
refactor(types): collapse duplicate IConnector interfaces
test(instagram): add carousel lazy-slide fixture
docs(architecture): update pipeline diagram
```

Scopes: `alpha`, `types`, `shared`, `storage`, `connector`, `crawler`,
`extension`, `popup`, `docs`.

## Coding standards

- TypeScript strict mode (`strict`, `noImplicitAny`, `exactOptionalPropertyTypes`).
- No `any` — use typed generics or narrow the type.
- ESLint + Prettier enforced in CI and via Husky pre-commit hooks.
- ESM (`"type": "module"`) with `.js` extensions in imports (Node16 resolution).
- No comments unless the **why** is non-obvious. No `// TODO` without an issue reference.

## Architecture rules

- The architecture is frozen. See [ARCHITECTURE.md](../architecture/ARCHITECTURE.md).
- Changes to frozen decisions require an RFC.
- dependency-cruiser enforces layer boundaries in CI.
- Platform-specific types stay inside their connector — never in `packages/types`.
- Content script is a pure DOM adapter — no parsing logic.
- Popup is monitoring-only — no execution logic.

## Testing

- Every connector must have fixture-based regression tests.
- Every production bug must produce a regression fixture before fixing.
- See [TESTING.md](TESTING.md) for the test strategy.

## Documentation

- Documentation is generated from the implementation, not the other way around.
- Every architectural change must update the relevant doc in `docs/architecture/`.
- Do not create planning documents in the repo — use PRs and issues.
