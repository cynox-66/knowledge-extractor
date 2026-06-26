import { IResource } from '@knowledge-extractor/types';
import { Logger } from '@knowledge-extractor/shared';
import { StrategyChain } from './strategy-chain.js';
import { InstagramParser, InstagramNormalizer } from './parser.js';
import {
  SemanticArticleStrategy,
  DataAttributeStrategy,
  StructuralHeuristicStrategy,
  ArticleElement,
} from './strategies.js';
import { IInstagramParsedPost } from '@knowledge-extractor/types';

export { DiscoveryEngine } from './discovery-engine.js';
export { ResourceFingerprinter } from './fingerprinter.js';

/**
 * The Instagram Connector — public entry point.
 *
 * Architecture:
 *   DOM Adapter (Content Script)
 *     → DiscoveryEngine (this package)
 *       → StrategyChain [Semantic → DataAttr → Heuristic]
 *         → InstagramParser (Instagram semantics)
 *           → InstagramNormalizer (domain contracts)
 */
export class InstagramConnector {
  public readonly providerName = 'instagram';

  private readonly logger = new Logger('InstagramConnector');
  private readonly chain = new StrategyChain<ArticleElement, IInstagramParsedPost>(
    'instagram-article',
    [new SemanticArticleStrategy(), new DataAttributeStrategy(), new StructuralHeuristicStrategy()],
  );
  private readonly parser = new InstagramParser();
  private readonly normalizer = new InstagramNormalizer();

  /**
   * Extracts and normalizes an Instagram article element into a domain resource.
   * @param article A DOM `<article>` element from the Instagram page.
   */
  async extractArticle(article: Element): Promise<IResource> {
    this.logger.debug('Extracting article');
    const raw = this.chain.execute(article);
    const enriched = this.parser.enrich(raw);
    return this.normalizer.normalize(enriched);
  }

  /**
   * Normalizes a pre-parsed `IInstagramParsedPost` (for use with fixtures/tests).
   */
  async normalize(post: IInstagramParsedPost): Promise<IResource> {
    const enriched = this.parser.enrich(post);
    return this.normalizer.normalize(enriched);
  }
}
