import { IConnector, IResource } from '@knowledge-extractor/types';
import { Logger } from '@knowledge-extractor/shared';
import { StrategyChain } from './strategy-chain.js';
import { InstagramParser, InstagramNormalizer } from './parser.js';
import {
  SemanticArticleStrategy,
  DataAttributeStrategy,
  StructuralHeuristicStrategy,
  ArticleElement,
} from './strategies.js';
import { IInstagramParsedPost } from './types.js';

export { DiscoveryEngine } from './discovery-engine.js';
export { ResourceFingerprinter } from './fingerprinter.js';
export { detectSurface, findOpenPostModal } from './surface.js';
export type { SurfaceDescriptor, SurfaceKind, OpenMode } from './surface.js';
export { findCarouselNext } from './carousel.js';
export type { IInstagramParsedPost, InstagramPostLayout } from './types.js';

/**
 * The Instagram Connector — public entry point and the single runtime
 * extraction implementation for Instagram.
 *
 * Architecture:
 *   DOM Adapter (Content Script) — provides the raw `<article>` Element only
 *     → InstagramConnector.extract()  [StrategyChain → InstagramParser.enrich]
 *       → IInstagramParsedPost (raw, Instagram-shaped)
 *         → InstagramConnector.normalize()  [InstagramNormalizer → IResource]
 *
 * Extraction (DOM → raw) runs where the DOM lives (content script); normalization
 * (raw → domain) is pure and may run anywhere (today: background worker).
 */
export class InstagramConnector implements IConnector<IInstagramParsedPost> {
  public readonly providerName = 'instagram';

  private readonly logger = new Logger('InstagramConnector');
  private readonly chain = new StrategyChain<ArticleElement, IInstagramParsedPost>(
    'instagram-article',
    [new SemanticArticleStrategy(), new DataAttributeStrategy(), new StructuralHeuristicStrategy()],
  );
  private readonly parser = new InstagramParser();
  private readonly normalizer = new InstagramNormalizer();

  /**
   * Validates whether this connector can handle the given URI.
   */
  canHandle(uri: string): boolean {
    return /(^|\.)instagram\.com$/.test(this.hostOf(uri)) || /\/(p|reel)\//.test(uri);
  }

  /**
   * Extracts a raw, Instagram-shaped record from a DOM `<article>` element.
   * This is the single runtime extraction path: StrategyChain → Parser.enrich.
   * Returns the enriched record tagged with the winning strategy name (for
   * diagnostics). Throws `PlatformError` (PARSE_ERROR) if every strategy is
   * exhausted.
   *
   * @param article A DOM `<article>` element from the Instagram page.
   */
  extract(article: ArticleElement): { post: IInstagramParsedPost; strategyName: string } {
    this.logger.debug('Extracting article via strategy chain');
    const { data, strategyName } = this.chain.execute(article);
    return { post: this.parser.enrich(data), strategyName };
  }

  /**
   * Normalizes a raw `IInstagramParsedPost` into the strict domain `IResource`.
   * Idempotent re-enrichment guards against callers passing un-enriched records
   * (e.g. fixtures/tests that build the raw shape directly).
   */
  async normalize(post: IInstagramParsedPost): Promise<IResource> {
    const enriched = this.parser.enrich(post);
    return this.normalizer.normalize(enriched);
  }

  private hostOf(uri: string): string {
    try {
      return new URL(uri).host;
    } catch {
      return '';
    }
  }
}
