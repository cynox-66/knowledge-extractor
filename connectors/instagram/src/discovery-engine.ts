import { IDiscoveredResource } from '@knowledge-extractor/types';
import { Logger } from '@knowledge-extractor/shared';
import { ResourceFingerprinter } from './fingerprinter.js';

type DiscoveryCallback = (resource: IDiscoveredResource, fingerprint: string) => void;

/**
 * The Discovery Engine monitors the Instagram DOM for post articles and grid items
 * using a MutationObserver and maintains a deduplication registry to prevent
 * repeated extraction of the same resource during infinite scrolling.
 *
 * It dynamically adapts to the current layout (Grid vs Feed vs Detail).
 */
export class DiscoveryEngine {
  private readonly logger = new Logger('DiscoveryEngine');
  private readonly fingerprinter = new ResourceFingerprinter();
  private readonly seen = new Set<string>();
  private observer: MutationObserver | null = null;
  private callback: DiscoveryCallback | null = null;

  start(callback: DiscoveryCallback): void {
    this.callback = callback;
    this.logger.info('Discovery Engine starting');

    this.scanDOM(document.body);

    this.observer = new MutationObserver((mutations) => {
      let shouldScan = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          shouldScan = true;
          break;
        }
      }
      if (shouldScan) {
        this.scanDOM(document.body);
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
    // 1. Grid layout: Look for post links inside typical grid containers
    const gridLinks = Array.from(
      root.querySelectorAll<HTMLAnchorElement>('a[href*="/p/"], a[href*="/reel/"]'),
    );
    for (const link of gridLinks) {
      // Exclude author profile links, explore tags, etc.
      if (this.isValidGridLink(link)) {
        this.processResource(link.href, link);
      }
    }

    // 2. Feed / Detail layout: Look for full article elements
    const articles = root.matches('article')
      ? [root]
      : Array.from(root.querySelectorAll('article'));

    for (const article of articles) {
      const link =
        article.querySelector<HTMLAnchorElement>('a[href*="/p/"]') ??
        article.querySelector<HTMLAnchorElement>('a[href*="/reel/"]');
      if (link) {
        this.processResource(link.href, article);
      }
    }
  }

  private isValidGridLink(link: HTMLAnchorElement): boolean {
    // Basic heuristic: grid items usually contain an image and aren't inside headers
    return link.querySelector('img') !== null && link.closest('header') === null;
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

    const fpInput: any = { sourceUri: cleanUri, mediaCount: imgs.length };
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
