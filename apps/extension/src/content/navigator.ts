import { Logger } from '@knowledge-extractor/shared';

/**
 * Owns all browser state manipulation for the content script.
 * Responsible for: scrolling, opening modals, closing modals, waiting.
 */
export class Navigator {
  private readonly logger = new Logger('Navigator');

  /**
   * Scrolls the window down by one viewport height and waits for dynamic content to load.
   * @returns true if scroll was successful, false if end of page was reached.
   */
  async scrollGrid(): Promise<boolean> {
    const previousHeight = document.documentElement.scrollHeight;

    // Scroll down by 80% of viewport height to trigger lazy load but keep some overlap
    window.scrollBy(0, window.innerHeight * 0.8);

    this.logger.debug('Scrolled down, waiting for DOM stabilization...');

    // Wait for infinite scroll to trigger and render
    await this.sleep(1500);

    const newHeight = document.documentElement.scrollHeight;

    // If the scroll height didn't change, we might be at the bottom
    if (newHeight === previousHeight) {
      // Try one more small scroll just in case
      window.scrollBy(0, window.innerHeight * 0.2);
      await this.sleep(1000);
      if (document.documentElement.scrollHeight === previousHeight) {
        this.logger.info('Reached end of grid (no new height after scroll)');
        return false;
      }
    }

    return true;
  }

  /**
   * Attempts to open the resource specified by targetUri in the current tab.
   * Uses Option A (Modal navigation) for grid items.
   */
  async openResource(targetUri: string): Promise<boolean> {
    // 1. Try to find the thumbnail link in the grid
    const links = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('a[href*="/p/"], a[href*="/reel/"]'),
    );
    const targetLink = links.find(
      (l) => l.href === targetUri || l.href.includes(new URL(targetUri).pathname),
    );

    if (targetLink) {
      this.logger.debug(`Clicking thumbnail for ${targetUri}`);

      // Ensure element is in view before clicking to avoid some overlay issues
      targetLink.scrollIntoView({ block: 'center', behavior: 'instant' });
      await this.sleep(100);

      // We dispatch a click event
      targetLink.click();

      // Wait for the modal article to appear
      const modalLoaded = await this.waitForSelector('article[role="presentation"]', 5000);
      if (!modalLoaded) {
        this.logger.warn(`Modal failed to load for ${targetUri}`);
        // Attempt to close if it's stuck half-open
        await this.closeResource();
        return false;
      }

      // Give it a brief moment for dynamic content (images, video) to hydrate
      await this.sleep(500);
      return true;
    }

    // 2. If no link is found, we might already be on a feed/detail page where the article is fully loaded
    const article = Array.from(document.querySelectorAll('article')).find((a) => {
      const link = a.querySelector<HTMLAnchorElement>('a[href*="/p/"], a[href*="/reel/"]');
      return link && (link.href === targetUri || link.href.includes(new URL(targetUri).pathname));
    });

    if (article) {
      this.logger.debug(`Resource already open in feed for ${targetUri}`);
      article.scrollIntoView({ block: 'center', behavior: 'instant' });
      await this.sleep(200);
      return true;
    }

    this.logger.error(`Could not locate resource in DOM to open: ${targetUri}`);
    return false;
  }

  /**
   * Closes the currently open modal (if any).
   */
  async closeResource(): Promise<void> {
    // Instagram modal close button usually has an SVG with aria-label "Close"
    const closeBtn =
      document.querySelector<HTMLButtonElement>('svg[aria-label="Close"]')?.closest('button') ||
      document.querySelector<HTMLButtonElement>('div[role="dialog"] button');

    if (closeBtn) {
      this.logger.debug('Clicking close button on modal');
      closeBtn.click();
      await this.sleep(300); // Wait for modal to animate out
    } else {
      // Fallback: If there's a dialog but no close button, try pressing Escape
      const dialog = document.querySelector('div[role="dialog"]');
      if (dialog) {
        this.logger.debug('No close button found, dispatching Escape key');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await this.sleep(300);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async waitForSelector(selector: string, timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (document.querySelector(selector)) return true;
      await this.sleep(100);
    }
    return false;
  }
}
