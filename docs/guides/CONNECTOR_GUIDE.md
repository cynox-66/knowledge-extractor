# Building a New Connector

This guide walks through adding a connector for a new source (e.g., Reddit,
LinkedIn). The Instagram connector (`connectors/instagram/`) is the reference
implementation.

## 1. Scaffold the package

```
connectors/reddit/
  package.json       name: @knowledge-extractor/connector-reddit
  tsconfig.json      extends ../../tsconfig.base.json
  src/
    index.ts         RedditConnector implements IConnector<IRedditParsedPost>
    types.ts         IRedditParsedPost extends IRawSourceResource
    strategies.ts    RedditApiStrategy, RedditDomStrategy, etc.
    strategy-chain.ts  (or reuse from a shared lib)
    parser.ts        RedditParser + RedditNormalizer
    discovery-engine.ts
    fingerprinter.ts
  tests/
    connector.test.ts
    fixtures/
      thread-post.html / .expected.json
```

Add the package to `pnpm-workspace.yaml` (already covered by `connectors/*`),
the root `tsconfig.json` references, and `apps/extension/package.json`
dependencies.

## 2. Define the connector-local raw type

Create a `types.ts` with your platform's intermediate parsed shape. It **must**
extend `IRawSourceResource`:

```typescript
import { IRawSourceResource } from '@knowledge-extractor/types';

export interface IRedditParsedPost extends IRawSourceResource {
  subreddit: string;
  score: number;
  commentCount: number;
  // ...
}
```

This type stays inside your connector — it never enters `packages/types`.

## 3. Implement extraction strategies

Each strategy implements `IExtractionStrategy<TInput, TOutput>`:

```typescript
import { IExtractionStrategy, IStrategyResult } from '@knowledge-extractor/types';
import { IRedditParsedPost } from './types.js';

export class RedditApiStrategy implements IExtractionStrategy<Element, IRedditParsedPost> {
  readonly strategyName = 'RedditApiStrategy';
  execute(el: Element): IStrategyResult<IRedditParsedPost> {
    /* ... */
  }
}
```

Order them by confidence in a `StrategyChain`. The chain tries each in order
and returns the first applicable result.

## 4. Implement the parser and normalizer

- **Parser**: understands your platform's semantics (Reddit's DOM or API
  response). Enriches the raw type (dedup URIs, infer layout, etc.).
- **Normalizer**: maps the enriched raw type into `IResource`. Must return a
  fully typed `IResource` — no `any`. Sets `kind`, `state`, `source`, `content`,
  `media`, `children`, `completeness`.

## 5. Implement the connector

```typescript
import { IConnector, IResource } from '@knowledge-extractor/types';
import { IRedditParsedPost } from './types.js';

export class RedditConnector implements IConnector<IRedditParsedPost> {
  readonly providerName = 'reddit';
  canHandle(uri: string): boolean {
    /* ... */
  }
  extract(el: Element): { post: IRedditParsedPost; strategyName: string } {
    /* ... */
  }
  async normalize(raw: IRedditParsedPost): Promise<IResource> {
    /* ... */
  }
}
```

## 6. Implement discovery and fingerprinting

- `DiscoveryEngine`: uses `MutationObserver` (or polling, or API) to find new
  resources. Emits `IDiscoveredResource` with `targetUri` and `providerName`.
- `ResourceFingerprinter`: computes `IResourceFingerprint` for dedup.

## 7. Write fixture tests

Create HTML fixtures that represent real DOM snapshots from your source. Pair
each with an `.expected.json` containing the expected `IResource` output. Test
each strategy independently and the full connector chain.

```typescript
it('correctly parses a reddit thread', async () => {
  const el = loadFixture('thread-post');
  const expected = loadExpected('thread-post');
  const resource = await connector.normalize(connector.extract(el).post);
  assertResource(resource, expected);
});
```

## 8. Wire into the extension

- Add a content script match pattern in `manifest.json` for your source's domain.
- In the content script, instantiate your connector and discovery engine alongside
  (or instead of) the Instagram ones, gated by the current page URL.
- The `CrawlController` and `Scheduler` are source-agnostic and require no changes.

## Rules

- Your connector may only import from `@knowledge-extractor/types` and
  `@knowledge-extractor/shared`. Never import other connectors.
- Platform-specific types stay in your connector's `types.ts`.
- No storage, orchestration, or UI logic inside the connector.
- Add `typecheck`, `lint`, and `test` scripts to your `package.json`.
