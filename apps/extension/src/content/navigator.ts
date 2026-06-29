import { Logger } from '@knowledge-extractor/shared';
import {
  type SurfaceDescriptor,
  findOpenPostModal,
  findCarouselNext,
} from '@knowledge-extractor/connector-instagram';

/**
 * Owns all browser state manipulation for the content script: scrolling,
 * opening posts, closing modals, waiting.
 *
 * Every operation is **surface-aware** (RCA-1/2/4). The Navigator is generic
 * mechanics; *what* to do per surface comes from the connector's
 * {@link SurfaceDescriptor}:
 *  - `home-feed` posts open **in place** (already rendered — never clicked into,
 *    which is what used to navigate the crawl off into the author's profile);
 *  - `grid` posts open as a **modal** detected via a robust multi-candidate
 *    matcher rather than one frozen selector;
 *  - scrolling targets the surface's real scroll container, not always `window`.
 */
export class Navigator {
  private readonly logger = new Logger('Navigator');

  /**
   * Scrolls the surface's scroll container by ~80% of its viewport to trigger
   * lazy loading, then reports whether new content height appeared.
   *
   * The success/height signal is advisory only — the CrawlController no longer
   * treats a single no-growth scroll as end-of-feed (RCA-3/4); it counts
   * consecutive unproductive scrolls instead.
   */
  async scroll(surface: SurfaceDescriptor): Promise<{ success: boolean; stabilizeMs?: number }> {
    const start = performance.now();
    const container = this.resolveScrollContainer(surface);
    const heightOf = (): number =>
      container ? container.scrollHeight : document.documentElement.scrollHeight;
    const viewport = (): number => (container ? container.clientHeight : window.innerHeight);
    const scrollBy = (dy: number): void => {
      if (container) container.scrollBy(0, dy);
      else window.scrollBy(0, dy);
    };

    const previousHeight = heightOf();
    scrollBy(viewport() * 0.8);
    this.logger.debug(
      `Scrolled ${surface.kind} (${container ? 'container' : 'window'}); waiting for load…`,
    );
    await this.sleep(1500);

    if (heightOf() === previousHeight) {
      // One more nudge before reporting no growth (the controller, not this
      // method, decides termination).
      scrollBy(viewport() * 0.2);
      await this.sleep(1000);
      if (heightOf() === previousHeight) {
        this.logger.info(`No new height after scrolling ${surface.kind}`);
        return { success: false, stabilizeMs: performance.now() - start };
      }
    }

    return { success: true, stabilizeMs: performance.now() - start };
  }

  /**
   * Opens the resource for extraction according to the surface's open mode.
   * Returns success once the post's `<article>` is present and stable.
   */
  async open(
    targetUri: string,
    surface: SurfaceDescriptor,
  ): Promise<{
    success: boolean;
    openLatencyMs?: number;
    domStabilizeMs?: number;
    error?: string;
  }> {
    return surface.openMode === 'modal' ? this.openModal(targetUri) : this.openInPlace(targetUri);
  }

  /**
   * In-place open (home feed / reels): the post is already rendered, so we only
   * locate and center it. We deliberately never click its permalink — that is a
   * real SPA navigation that used to carry the crawl into the author's profile
   * (RCA-2).
   */
  private async openInPlace(targetUri: string): Promise<{
    success: boolean;
    openLatencyMs?: number;
    domStabilizeMs?: number;
    error?: string;
  }> {
    const article = this.findArticleForUri(targetUri);
    if (!article) {
      this.logger.warn(`In-place resource not found in feed: ${targetUri}`);
      return { success: false, error: 'Not found in feed' };
    }
    article.scrollIntoView({ block: 'center', behavior: 'instant' });
    const stabilizeStart = performance.now();
    await this.sleep(200);
    return {
      success: true,
      openLatencyMs: 0,
      domStabilizeMs: performance.now() - stabilizeStart,
    };
  }

  /**
   * Modal open (grid surfaces): click the thumbnail and wait for a real post
   * modal, validated by a multi-candidate detector instead of one brittle
   * selector (RCA-1).
   */
  private async openModal(targetUri: string): Promise<{
    success: boolean;
    openLatencyMs?: number;
    domStabilizeMs?: number;
    error?: string;
  }> {
    const targetLink = this.findThumbnailForUri(targetUri);
    if (!targetLink) {
      this.logger.error(`Could not locate grid thumbnail to open: ${targetUri}`);
      return { success: false, error: 'Thumbnail not found in DOM' };
    }

    targetLink.scrollIntoView({ block: 'center', behavior: 'instant' });
    await this.sleep(100);

    const clickTime = performance.now();
    targetLink.click();

    const modalOpened = await this.waitFor(() => findOpenPostModal() !== null, 5000);
    const openLatencyMs = performance.now() - clickTime;

    if (!modalOpened) {
      this.logger.warn(`Modal failed to open for ${targetUri}`);
      await this.close(); // best-effort cleanup if it half-opened
      return { success: false, openLatencyMs, error: 'Modal timeout' };
    }

    const stabilizeStart = performance.now();
    await this.sleep(500);
    return { success: true, openLatencyMs, domStabilizeMs: performance.now() - stabilizeStart };
  }

  /**
   * Closes an open post modal, if any, and confirms it is gone so the grid is
   * restored before the crawl continues. A no-op (success) when no modal is
   * open — e.g. after in-place extraction.
   */
  async close(): Promise<{ success: boolean; closeDurationMs?: number }> {
    const start = performance.now();
    if (findOpenPostModal() === null) {
      return { success: true, closeDurationMs: 0 };
    }

    const closeBtn =
      document.querySelector<HTMLButtonElement>('svg[aria-label="Close"]')?.closest('button') ??
      document.querySelector<HTMLButtonElement>('div[role="dialog"] button');

    if (closeBtn) {
      this.logger.debug('Clicking modal close button');
      closeBtn.click();
    } else {
      this.logger.debug('No close button; dispatching Escape');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }

    // Confirm the modal actually closed (restores grid context for the route
    // guard) before reporting success.
    const closed = await this.waitFor(() => findOpenPostModal() === null, 2000);
    if (!closed) this.logger.warn('Modal did not close within timeout');
    return { success: closed, closeDurationMs: performance.now() - start };
  }

  /**
   * Advances a carousel to its next slide, scoped to `scope` (the post element)
   * so it never clicks a neighbouring post's control on the home feed. Returns
   * `false` when there is no Next control — the last slide, or a non-carousel
   * post — which is how the caller's collection loop terminates (RCA-7).
   */
  async advanceCarousel(scope: ParentNode): Promise<boolean> {
    const next = findCarouselNext(scope);
    if (!next) return false;
    next.click();
    // Allow the slide transition to settle before the caller re-reads media.
    await this.sleep(600);
    return true;
  }

  // ---- DOM helpers ----------------------------------------------------------

  /** Resolves the surface's scroll container, or `null` to scroll the window. */
  private resolveScrollContainer(surface: SurfaceDescriptor): HTMLElement | null {
    for (const selector of surface.scrollContainerSelectors) {
      const el = document.querySelector<HTMLElement>(selector);
      // Only treat it as the scroller if it can actually scroll.
      if (el && el.scrollHeight > el.clientHeight) return el;
    }
    return null;
  }

  /** Finds the in-DOM `<article>` whose permalink matches `targetUri`. */
  private findArticleForUri(targetUri: string): Element | undefined {
    const pathname = this.safePathname(targetUri);
    return Array.from(document.querySelectorAll('article')).find((a) => {
      const link =
        a.querySelector<HTMLAnchorElement>('a[href*="/p/"]') ??
        a.querySelector<HTMLAnchorElement>('a[href*="/reel/"]');
      if (!link) return false;
      return link.href === targetUri || (pathname !== '' && link.href.includes(pathname));
    });
  }

  /** Finds the grid thumbnail anchor whose permalink matches `targetUri`. */
  private findThumbnailForUri(targetUri: string): HTMLAnchorElement | undefined {
    const pathname = this.safePathname(targetUri);
    const links = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('a[href*="/p/"], a[href*="/reel/"]'),
    );
    return links.find(
      (l) => l.href === targetUri || (pathname !== '' && l.href.includes(pathname)),
    );
  }

  private safePathname(uri: string): string {
    try {
      return new URL(uri).pathname;
    } catch {
      return '';
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Polls `predicate` until true or the timeout elapses. */
  private async waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (predicate()) return true;
      await this.sleep(100);
    }
    return false;
  }
}
