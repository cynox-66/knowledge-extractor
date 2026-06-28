/**
 * Content Script — DOM Adapter Layer (Alpha Diagnostic Build)
 *
 * Responsibility: DOM access only. It locates the target `<article>` element and
 * delegates ALL parsing to the Instagram Connector (the single runtime extraction
 * implementation). It captures a trimmed DOM snapshot on failure for diagnostics.
 */
import { IDiscoveredResource } from '@knowledge-extractor/types';
import { Logger, featureFlags, FeatureFlag, MetricsCollector } from '@knowledge-extractor/shared';
import { DiscoveryEngine, InstagramConnector } from '@knowledge-extractor/connector-instagram';
import { Navigator } from './navigator.js';

const logger = new Logger('ContentScript');
const metrics = new MetricsCollector();
const engine = new DiscoveryEngine();
const connector = new InstagramConnector();
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

  if (message.action === 'CAPTURE_MEDIA') {
    const items = (message.data?.mediaItems ?? []) as Array<{
      id: string;
      sourceUri: string;
      mimeType?: string;
    }>;
    captureMedia(items)
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true;
  }

  return false;
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

// ---- Per-resource extraction (DOM location only; parsing delegated) ---------
async function extractSingleResource(targetUri: string): Promise<{
  success: boolean;
  data?: unknown;
  strategyName?: string;
  domSnapshot?: string;
  error?: string;
}> {
  // DOM concern: locate the target <article> for this URI (modal or feed),
  // falling back to the single-post detail view's lone <article>.
  const target = findArticleForUri(targetUri) ?? document.querySelector('article');

  if (!target) {
    return {
      success: false,
      domSnapshot: document.body.innerHTML.slice(0, 2000),
      error: 'No article element found for URI',
    };
  }

  // Trimmed DOM snapshot for failure diagnostics.
  const domSnapshot = target.outerHTML.slice(0, 2000);

  try {
    // Parsing concern: delegated entirely to the connector's strategy chain.
    const { post, strategyName } = connector.extract(target);
    return { success: true, data: post, strategyName };
  } catch (err) {
    return { success: false, domSnapshot, error: String(err) };
  }
}

/** Locates the <article> in the live DOM whose permalink matches `targetUri`. */
function findArticleForUri(targetUri: string): Element | undefined {
  const pathname = safePathname(targetUri);
  return Array.from(document.querySelectorAll('article')).find((a) => {
    const link =
      a.querySelector<HTMLAnchorElement>('a[href*="/p/"]') ??
      a.querySelector<HTMLAnchorElement>('a[href*="/reel/"]');
    if (!link) return false;
    return link.href === targetUri || (pathname !== '' && link.href.includes(pathname));
  });
}

function safePathname(uri: string): string {
  try {
    return new URL(uri).pathname;
  } catch {
    return '';
  }
}

// ---- Media capture (Beta-1) ------------------------------------------------
//
// Owned by the page-origin content script because only it can fetch
// Instagram's CDN with the live authenticated session cookies. Service-worker
// fetches against `scontent.cdninstagram.com` are 403 or CORS-blocked. Bytes
// are returned to the background as transferable `ArrayBuffer`s.

interface CaptureRequest {
  id: string;
  sourceUri: string;
  mimeType?: string;
}

interface CaptureResult {
  success: true;
  captured: Array<{
    id: string;
    bytes: ArrayBuffer;
    mimeType: string;
    sizeBytes: number;
    source: string;
  }>;
  failed: Array<{ id: string; error: string }>;
}

async function captureMedia(items: CaptureRequest[]): Promise<CaptureResult> {
  const captured: CaptureResult['captured'] = [];
  const failed: CaptureResult['failed'] = [];

  // Sequential fetches to avoid spiking the network and to keep memory bounded.
  // Per-item failures never abort the batch.
  for (const item of items) {
    try {
      const response = await fetch(item.sourceUri, { credentials: 'include' });
      if (!response.ok) {
        failed.push({ id: item.id, error: `HTTP ${response.status}` });
        continue;
      }
      const buffer = await response.arrayBuffer();
      const mimeType =
        response.headers.get('content-type') ?? item.mimeType ?? 'application/octet-stream';
      captured.push({
        id: item.id,
        bytes: buffer,
        mimeType,
        sizeBytes: buffer.byteLength,
        source: item.sourceUri,
      });
    } catch (err) {
      failed.push({ id: item.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  logger.info(`captureMedia: captured=${captured.length} failed=${failed.length}`);
  return { success: true, captured, failed };
}
