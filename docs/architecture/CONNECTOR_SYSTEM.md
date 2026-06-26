# Connector System

## Contract

Every connector implements `IConnector<TRaw>` from `@knowledge-extractor/types`:

```typescript
interface IConnector<TRaw extends IRawSourceResource = IRawSourceResource> {
  readonly providerName: string;
  canHandle(uri: string): boolean;
  normalize(raw: TRaw): Promise<IResource>;
}
```

`TRaw` is parameterized so the connector can accept its own richer intermediate
type (e.g., `IInstagramParsedPost`) without leaking that type into the
engine layer. The engine only sees `IConnector` and `IResource`.

## Connector scope

A connector is responsible for three things:

1. **Discover** — find resources in the source (DOM, API, file system).
2. **Extract** — parse raw data from the source into a connector-local type.
3. **Normalize** — map the raw type into the domain `IResource`.

A connector must **never** own storage, scheduling, orchestration, or UI.

## StrategyChain

Extraction uses a `StrategyChain<TInput, TOutput>` — an ordered list of
`IExtractionStrategy` implementations tried in sequence. The first applicable
result wins. Returns `{ data, strategyName }` so diagnostics can record which
strategy was used.

```typescript
interface IExtractionStrategy<TInput, TOutput> {
  readonly strategyName: string;
  execute(input: TInput): IStrategyResult<TOutput>;
}

interface IStrategyResult<T> {
  applicable: boolean;
  confidence: number; // 0.0–1.0
  data?: T;
  failureReason?: string;
}
```

The Instagram connector's chain:

| Order | Strategy                      | Confidence | Approach                                      |
| ----- | ----------------------------- | ---------- | --------------------------------------------- |
| 1     | `SemanticArticleStrategy`     | 0.85       | ARIA roles, `href` patterns, `time[datetime]` |
| 2     | `DataAttributeStrategy`       | 0.50       | Class-name fragments, `<img>` heuristics      |
| 3     | `StructuralHeuristicStrategy` | 0.20       | Any block with images and links               |

## Fingerprinting

`ResourceFingerprinter` computes a deterministic `IResourceFingerprint` (djb2
hash) from `sourceUri`, `authorHandle`, `mediaCount`, and `captionPreview`.
Used by the `DiscoveryEngine` for deduplication before normalization.

## File layout (Instagram example)

```
connectors/instagram/
  src/
    index.ts           InstagramConnector (IConnector implementation)
    types.ts           IInstagramParsedPost, InstagramPostLayout
    strategies.ts      SemanticArticle, DataAttribute, StructuralHeuristic
    strategy-chain.ts  StrategyChain<TInput, TOutput>
    parser.ts          InstagramParser (enrich) + InstagramNormalizer (→ IResource)
    discovery-engine.ts  DiscoveryEngine (MutationObserver)
    fingerprinter.ts   ResourceFingerprinter (djb2 hash)
  tests/
    connector.test.ts  Fixture-based regression tests
    fixtures/          HTML fixtures + expected JSON
```

## Adding a new connector

See [docs/guides/CONNECTOR_GUIDE.md](../guides/CONNECTOR_GUIDE.md).
