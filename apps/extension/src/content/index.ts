/**
 * Content Script — DOM Adapter Layer (Alpha Diagnostic Build)
 *
 * Extended with DOM snapshot capture for failure analysis.
 * Snapshots are trimmed to 2000 chars and only captured on failure.
 */
import { IDiscoveredResource } from '@knowledge-extractor/types';
import { Logger, featureFlags, FeatureFlag, MetricsCollector } from '@knowledge-extractor/shared';
import { DiscoveryEngine } from '@knowledge-extractor/connector-instagram';
import { Navigator } from './navigator';

const logger = new Logger('ContentScript');
const metrics = new MetricsCollector();
const engine = new DiscoveryEngine();
const navigator = new Navigator();

const pendingQueue: Array<{ resource: IDiscoveredResource; fingerprint: string }> = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

// ---- Message listener -------------------------------------------------------
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'RUN_PIPELINE') {
    startDiscovery()
      .then(() => sendResponse({ success: true }))
      .catch((err: unknown) => {
        logger.error('Pipeline error', err);
        sendResponse({ success: false, error: String(err) });
      });
    return true;
  }

  if (message.action === 'STOP_PIPELINE') {
    engine.stop();
    sendResponse({ metrics: metrics.snapshot() });
    return true;
  }

  if (message.action === 'EXTRACT_RESOURCE') {
    const { targetUri } = (message.data ?? {}) as { targetUri: string };
    extractSingleResource(targetUri)
      .then(sendResponse)
      .catch((err: unknown) => sendResponse({ success: false, error: String(err) }));
    return true;
  }

  if (message.action === 'NAVIGATE_OPEN') {
    const { targetUri } = (message.data ?? {}) as { targetUri: string };
    navigator
      .openResource(targetUri)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true;
  }

  if (message.action === 'NAVIGATE_CLOSE') {
    navigator
      .closeResource()
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true;
  }

  if (message.action === 'NAVIGATE_SCROLL') {
    navigator
      .scrollGrid()
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true;
  }
});

// ---- Discovery orchestration ------------------------------------------------
async function startDiscovery(): Promise<void> {
  if (!featureFlags.isEnabled(FeatureFlag.ENABLE_DISCOVERY)) {
    logger.warn('Discovery disabled by feature flag');
    return;
  }

  metrics.reset();
  logger.info('Starting DiscoveryEngine');

  engine.start((resource, fingerprint) => {
    metrics.recordDiscovered();
    pendingQueue.push({ resource, fingerprint });
    scheduleFlush();
  });
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushQueue();
    flushTimer = null;
  }, 150);
}

function flushQueue(): void {
  if (pendingQueue.length === 0) return;
  const batch = pendingQueue.splice(0, pendingQueue.length);
  logger.debug(`Flushing ${batch.length} discovered resources to background`);
  chrome.runtime.sendMessage({ action: 'RESOURCES_DISCOVERED', data: batch }).catch(() => {});
}

// ---- Per-resource extraction with DOM snapshot capture ---------------------
async function extractSingleResource(targetUri: string): Promise<{
  success: boolean;
  data?: unknown;
  domSnapshot?: string;
  error?: string;
}> {
  // Find the article element in the current DOM matching this URI
  const articles = Array.from(document.querySelectorAll('article'));
  const article = articles.find((a) => {
    const link =
      a.querySelector<HTMLAnchorElement>('a[href*="/p/"]') ??
      a.querySelector<HTMLAnchorElement>('a[href*="/reel/"]');
    return link?.href === targetUri || link?.href.includes(new URL(targetUri).pathname);
  });

  if (!article) {
    // Single-page post view — use the whole document body
    const bodyArticle = document.querySelector('article');
    if (!bodyArticle) {
      return {
        success: false,
        domSnapshot: document.body.innerHTML.slice(0, 2000),
        error: 'No article element found for URI',
      };
    }
  }

  const target = article ?? document.querySelector('article');
  if (!target) {
    return { success: false, error: 'No article element available' };
  }

  // Capture a trimmed DOM snapshot for failure analysis
  const domSnapshot = target.outerHTML.slice(0, 2000);

  try {
    // Extract raw structured data from the DOM element
    const link =
      target.querySelector<HTMLAnchorElement>('a[href*="/p/"]') ??
      target.querySelector<HTMLAnchorElement>('a[href*="/reel/"]');

    const sourceUri = link?.href ?? targetUri;
    const match = sourceUri.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/);
    const externalId = match ? match[1] : '';

    const authorEl = target.querySelector<HTMLAnchorElement>('header a[role="link"]');
    const authorHandle = authorEl?.textContent?.trim();
    const authorDisplayName = authorEl
      ?.closest('header')
      ?.querySelector<HTMLElement>('span:last-child')
      ?.textContent?.trim();

    const captionEl = target.querySelector<HTMLElement>(
      '[data-testid="post-comment-root"] span, h1',
    );
    const textContent = captionEl?.textContent?.trim();

    const timeEl = target.querySelector<HTMLTimeElement>('time[datetime]');
    const publishedAt = timeEl?.getAttribute('datetime') ?? undefined;

    const videoEl = target.querySelector<HTMLVideoElement>('video');
    const videoUri = videoEl?.src || videoEl?.querySelector('source')?.src;

    const imgEls = Array.from(
      target.querySelectorAll<HTMLImageElement>('img[srcset], img[src]'),
    ).filter((img) => !img.src.includes('avatar') && (img.width > 100 || img.naturalWidth > 100));

    const mediaUris = [...new Set(imgEls.map((img) => img.src).filter(Boolean))];

    const isReel = sourceUri.includes('/reel/');
    const hasDots = target.querySelectorAll('[aria-label*="slide"], [class*="dot"]').length > 1;
    const layout =
      isReel || videoUri ? 'reel' : hasDots || mediaUris.length > 1 ? 'carousel' : 'single-image';

    return {
      success: true,
      data: {
        providerName: 'instagram',
        sourceUri,
        externalId,
        authorHandle,
        authorDisplayName,
        textContent,
        publishedAt,
        mediaUris: videoUri ? [videoUri, ...mediaUris] : mediaUris,
        videoUri,
        layout,
      },
    };
  } catch (err) {
    return {
      success: false,
      domSnapshot,
      error: String(err),
    };
  }
}
