import { IDiscoveredResource } from '@knowledge-extractor/types';
import { Logger } from '@knowledge-extractor/shared';
import { ResourceFingerprinter } from './fingerprinter';

type DiscoveryCallback = (resource: IDiscoveredResource, fingerprint: string) => void;

/**
 * The Discovery Engine monitors the Instagram DOM for post articles
 * using a MutationObserver and maintains a deduplication registry to prevent
 * repeated extraction of the same resource during infinite scrolling.
 *
 * Pipeline: MutationObserver → Discovery Queue → Deduplication → Callback
 */
export class DiscoveryEngine {
  private readonly logger = new Logger('DiscoveryEngine');
  private readonly fingerprinter = new ResourceFingerprinter();
  private readonly seen = new Set<string>();
  private observer: MutationObserver | null = null;
  private callback: DiscoveryCallback | null = null;

  /**
   * Start observing the DOM for new Instagram article elements.
   * @param callback Invoked for each newly discovered, deduplicated resource.
   */
  start(callback: DiscoveryCallback): void {
    this.callback = callback;
    this.logger.info('Discovery Engine starting');

    // Immediately scan current DOM state
    this.scanDOM(document.body);

    // Then watch for dynamic mutations (infinite scroll, SPA navigation)
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof Element) {
            this.scanDOM(node);
          }
        });
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
    const articles = root.matches('article')
      ? [root]
      : Array.from(root.querySelectorAll('article'));

    for (const article of articles) {
      this.processArticle(article);
    }
  }

  private processArticle(article: Element): void {
    const link =
      article.querySelector<HTMLAnchorElement>('a[href*="/p/"]') ??
      article.querySelector<HTMLAnchorElement>('a[href*="/reel/"]');

    if (!link) return;

    const sourceUri = link.href;
    const authorEl = article.querySelector<HTMLAnchorElement>('header a');
    const imgs = article.querySelectorAll('img');

    const fp = this.fingerprinter.fingerprint({
      sourceUri,
      authorHandle: authorEl?.textContent?.trim(),
      mediaCount: imgs.length,
      captionPreview: article.querySelector('h1, span')?.textContent?.slice(0, 64),
    });

    if (this.seen.has(fp.hash)) {
      this.logger.debug(`Duplicate resource skipped: ${fp.hash}`);
      return;
    }

    this.seen.add(fp.hash);
    this.logger.info(`Discovered new resource: ${sourceUri} (fp=${fp.hash})`);

    this.callback?.({ targetUri: sourceUri, providerName: 'instagram' }, fp.hash);
  }

  getDiscoveredCount(): number {
    return this.seen.size;
  }
}
