import { IDiscoveredResource, IResourceFingerprint } from '@knowledge-extractor/types';
import { Logger } from '@knowledge-extractor/shared';
import { ResourceFingerprinter } from './fingerprinter.js';
import { detectSurface, type SurfaceDescriptor } from './surface.js';

type DiscoveryCallback = (resource: IDiscoveredResource, fingerprint: string) => void;

/**
 * The Discovery Engine monitors the Instagram DOM for post articles and grid items
 * using a MutationObserver and maintains a deduplication registry to prevent
 * repeated extraction of the same resource during infinite scrolling.
 *
 * It dynamically adapts to the current layout (Grid vs Feed vs Detail) and is
 * pinned to the crawl's **surface**: it only scans while the page is still on
 * that surface, and it never scans inside an open post modal. Together these
 * stop the engine queueing a post-detail page's "more from this author" links —
 * the cause of the crawler wandering into the author's profile (RCA-2/5).
 */
export class DiscoveryEngine {
  private readonly logger = new Logger('DiscoveryEngine');
  private readonly fingerprinter = new ResourceFingerprinter();
  private readonly seen = new Set<string>();
  private observer: MutationObserver | null = null;
  private callback: DiscoveryCallback | null = null;
  /** The surface this engine is pinned to, captured at {@link start}. */
  private surface: SurfaceDescriptor | null = null;

  /**
   * @param surface The crawl surface, captured by the content script at pipeline
   *   start. Defaults to the surface of the current URL when omitted.
   */
  start(callback: DiscoveryCallback, surface?: SurfaceDescriptor): void {
    this.callback = callback;
    this.surface = surface ?? detectSurface(location.href);
    this.logger.info(`Discovery Engine starting on surface: ${this.surface.kind}`);

    this.scanDOM(document.body);

    this.observer = new MutationObserver((mutations) => {
      // Incremental scan (RCA-9 / RFC-0001 A4): scan only the subtrees that were
      // added, not the whole document on every mutation. Infinite scroll appends
      // a bounded number of nodes per batch, so cost stays linear in *new* DOM
      // instead of quadratic in total collection size.
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            this.scanDOM(node as Element);
          }
        }
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    this.logger.info('Discovery Engine active');
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.logger.info(`Discovery Engine stopped. Total unique resources found: ${this.seen.size}`);
  }

  private scanDOM(root: Element): void {
    // Route guard: if the page has genuinely navigated off the crawl surface
    // (e.g. an accidental click landed on a post-detail/profile page), stop
    // discovering — those links do not belong to this crawl (RCA-2/5).
    if (this.surface && !this.surface.isOnSurface(location.href)) {
      this.logger.debug(`Off-surface (${location.pathname}); skipping scan`);
      return;
    }

    // Surface-specific discovery (RCA-5): grids expose thumbnail links; the home
    // feed and reels render full articles. Scanning only the relevant layout
    // avoids false positives (e.g. harvesting feed-style links on a grid).
    // `unknown` surfaces fall back to scanning both.
    const kind = this.surface?.kind ?? 'unknown';
    if (kind === 'grid' || kind === 'unknown') this.scanGridLinks(root);
    if (kind === 'home-feed' || kind === 'reels' || kind === 'unknown') this.scanArticles(root);
  }

  /** Grid layout: post/reel thumbnail links inside grid containers. */
  private scanGridLinks(root: Element): void {
    // Include `root` itself when it is a thumbnail link: under incremental
    // scanning the appended node may *be* the link, which `querySelectorAll`
    // (descendants only) would otherwise miss.
    const selector = 'a[href*="/p/"], a[href*="/reel/"]';
    const gridLinks = Array.from(root.querySelectorAll<HTMLAnchorElement>(selector));
    if (root.matches(selector)) gridLinks.unshift(root as HTMLAnchorElement);
    for (const link of gridLinks) {
      // Exclude author profile links, explore tags, and links inside an open
      // post modal (the modal's "more posts from this author" suggestions).
      if (this.isValidGridLink(link)) {
        this.processResource(link.href, link);
      }
    }
  }

  /** Feed / detail layout: full <article> elements carrying a permalink. */
  private scanArticles(root: Element): void {
    const articles = root.matches('article')
      ? [root]
      : Array.from(root.querySelectorAll('article'));

    for (const article of articles) {
      // Never harvest links from inside the open modal — only the base feed/grid.
      if (this.isInsideModal(article)) continue;
      const link =
        article.querySelector<HTMLAnchorElement>('a[href*="/p/"]') ??
        article.querySelector<HTMLAnchorElement>('a[href*="/reel/"]');
      if (link) {
        this.processResource(link.href, article);
      }
    }
  }

  private isValidGridLink(link: HTMLAnchorElement): boolean {
    // Basic heuristic: grid items usually contain an image and aren't inside
    // headers, and must not live inside an open post modal (RCA-2/5).
    return (
      link.querySelector('img') !== null &&
      link.closest('header') === null &&
      !this.isInsideModal(link)
    );
  }

  /** Whether an element sits inside an open post modal (excluded from scans). */
  private isInsideModal(el: Element): boolean {
    return el.closest('div[role="dialog"], article[role="presentation"]') !== null;
  }

  private processResource(sourceUri: string, contextEl: Element): void {
    // Normalize URL to strip query params
    let cleanUri = sourceUri;
    try {
      const url = new URL(sourceUri);
      cleanUri = url.origin + url.pathname;
    } catch {
      // ignore
    }

    const authorEl = contextEl.querySelector<HTMLAnchorElement>('header a');
    const imgs = contextEl.querySelectorAll('img');

    const fpInput: IResourceFingerprint['inputs'] = {
      sourceUri: cleanUri,
      mediaCount: imgs.length,
    };
    const authorHandle = authorEl?.textContent?.trim();
    if (authorHandle) fpInput.authorHandle = authorHandle;
    const captionPreview = contextEl.querySelector('h1, span')?.textContent?.slice(0, 64);
    if (captionPreview) fpInput.captionPreview = captionPreview;

    const fp = this.fingerprinter.fingerprint(fpInput);

    if (this.seen.has(fp.hash)) {
      return;
    }

    this.seen.add(fp.hash);
    this.logger.info(`Discovered new resource: ${cleanUri} (fp=${fp.hash})`);

    this.callback?.({ targetUri: cleanUri, providerName: 'instagram' }, fp.hash);
  }

  getDiscoveredCount(): number {
    return this.seen.size;
  }
}
