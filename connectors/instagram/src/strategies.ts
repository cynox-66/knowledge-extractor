import {
  IExtractionStrategy,
  IStrategyResult,
  IInstagramParsedPost,
} from '@knowledge-extractor/types';

export type ArticleElement = Element;

// ---------------------------------------------------------------------------
// Strategy A: Semantic article selectors (highest confidence)
// Targets stable landmark roles and well-known data attributes.
// ---------------------------------------------------------------------------
export class SemanticArticleStrategy implements IExtractionStrategy<
  ArticleElement,
  IInstagramParsedPost
> {
  readonly strategyName = 'SemanticArticleStrategy';

  execute(article: ArticleElement): IStrategyResult<IInstagramParsedPost> {
    const link =
      article.querySelector<HTMLAnchorElement>('a[href*="/p/"]') ??
      article.querySelector<HTMLAnchorElement>('a[href*="/reel/"]');

    if (!link) {
      return {
        applicable: false,
        confidence: 0,
        failureReason: 'No post/reel permalink found via semantic selector',
      };
    }

    const sourceUri = link.href;
    const externalId = this.extractId(sourceUri);
    const isReel = sourceUri.includes('/reel/');

    const authorEl = article.querySelector<HTMLAnchorElement>('header a[role="link"]');
    const authorHandle = authorEl?.textContent?.trim() ?? undefined;
    const authorDisplayName =
      authorEl
        ?.closest('header')
        ?.querySelector<HTMLElement>('span:last-child')
        ?.textContent?.trim() ?? undefined;

    const captionEl = article.querySelector<HTMLElement>(
      '[data-testid="post-comment-root"] span, h1',
    );
    const textContent = captionEl?.textContent?.trim() ?? undefined;

    const timeEl = article.querySelector<HTMLTimeElement>('time[datetime]');
    const publishedAt = timeEl?.getAttribute('datetime') ?? undefined;

    const videoEl = article.querySelector<HTMLVideoElement>('video');
    const videoUri = videoEl?.src || videoEl?.querySelector('source')?.src;

    const imgEls = Array.from(
      article.querySelectorAll<HTMLImageElement>('img[srcset], img[src]'),
    ).filter((img) => !img.src.includes('avatar') && img.width > 100);

    const mediaUris = [...new Set(imgEls.map((img) => img.src).filter(Boolean))];
    const slideUris = imgEls.length > 1 ? mediaUris : undefined;

    const dots = article.querySelectorAll('[aria-label*="slide"], [class*="dot"]');
    const layout = isReel
      ? 'reel'
      : dots.length > 1 || (slideUris && slideUris.length > 1)
        ? 'carousel'
        : videoUri
          ? 'reel'
          : 'single-image';

    const data: IInstagramParsedPost = {
      providerName: 'instagram',
      sourceUri,
      externalId,
      mediaUris: videoUri ? [videoUri, ...mediaUris] : mediaUris,
      layout,
    };
    if (authorHandle) data.authorHandle = authorHandle;
    if (authorDisplayName) data.authorDisplayName = authorDisplayName;
    if (textContent) data.textContent = textContent;
    if (publishedAt) data.publishedAt = publishedAt;
    if (slideUris) data.slideUris = slideUris;
    if (videoUri) data.videoUri = videoUri;

    return {
      applicable: true,
      confidence: 0.85,
      data,
    };
  }

  private extractId(uri: string): string {
    const m = uri.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : '';
  }
}

// ---------------------------------------------------------------------------
// Strategy B: Data-attribute fallback (medium confidence)
// Targets common class-name fragments Instagram injects at build time.
// ---------------------------------------------------------------------------
export class DataAttributeStrategy implements IExtractionStrategy<
  ArticleElement,
  IInstagramParsedPost
> {
  readonly strategyName = 'DataAttributeStrategy';

  execute(article: ArticleElement): IStrategyResult<IInstagramParsedPost> {
    const link = article.querySelector<HTMLAnchorElement>('a[href]');
    if (!link || !/\/(p|reel)\//.test(link.href)) {
      return {
        applicable: false,
        confidence: 0,
        failureReason: 'No post/reel href found via data-attribute strategy',
      };
    }

    const sourceUri = link.href;
    const externalId = (sourceUri.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/) ?? [])[1] ?? '';

    const imgs = Array.from(article.querySelectorAll<HTMLImageElement>('img')).filter(
      (img) => img.naturalWidth > 50 || img.src,
    );
    const mediaUris = [...new Set(imgs.map((img) => img.src).filter(Boolean))];

    const textNodes = Array.from(article.querySelectorAll('span'))
      .map((s) => s.textContent?.trim())
      .filter(Boolean);
    const textContent = textNodes.length > 0 ? textNodes.join(' ') : undefined;

    const data: IInstagramParsedPost = {
      providerName: 'instagram',
      sourceUri,
      externalId,
      mediaUris,
      layout: 'single-image',
    };
    if (textContent) data.textContent = textContent;

    return {
      applicable: true,
      confidence: 0.5,
      data,
    };
  }
}

// ---------------------------------------------------------------------------
// Strategy C: Structural heuristics (low confidence, last resort)
// Attempts extraction from any block containing images and links.
// ---------------------------------------------------------------------------
export class StructuralHeuristicStrategy implements IExtractionStrategy<
  ArticleElement,
  IInstagramParsedPost
> {
  readonly strategyName = 'StructuralHeuristicStrategy';

  execute(article: ArticleElement): IStrategyResult<IInstagramParsedPost> {
    const imgs = article.querySelectorAll('img');
    const links = article.querySelectorAll('a[href]');

    if (imgs.length === 0) {
      return {
        applicable: false,
        confidence: 0,
        failureReason: 'No images found — cannot apply structural heuristic',
      };
    }

    const sourceUri =
      links.length > 0 ? (links[0] as HTMLAnchorElement).href : window.location.href;

    const data: IInstagramParsedPost = {
      providerName: 'instagram',
      sourceUri,
      externalId: Date.now().toString(),
      mediaUris: Array.from(imgs)
        .map((img) => (img as HTMLImageElement).src)
        .filter(Boolean),
      layout: 'unknown',
    };
    const textContent = article.textContent?.slice(0, 200).trim();
    if (textContent) data.textContent = textContent;

    return {
      applicable: true,
      confidence: 0.2,
      data,
    };
  }
}
