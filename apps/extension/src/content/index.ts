/**
 * Content Script — DOM Adapter Layer
 *
 * Responsibility: Observe the Instagram DOM and relay raw article elements
 * as structured payloads to the Background Worker.
 *
 * This script is deliberately free of domain model logic. It knows about
 * browser APIs and the Instagram page structure only through the
 * DiscoveryEngine and the strategy chain that lives in the connector package.
 */
import { IDiscoveredResource } from '@knowledge-extractor/types';
import { Logger, featureFlags, FeatureFlag, MetricsCollector } from '@knowledge-extractor/shared';
import { DiscoveryEngine } from '@knowledge-extractor/connector-instagram';

const logger = new Logger('ContentScript');
const metrics = new MetricsCollector();
const engine = new DiscoveryEngine();

// Discovery queue: discovered resources waiting to be batch-sent
const pendingQueue: Array<{ resource: IDiscoveredResource; fingerprint: string }> = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

// ---- Message listener -------------------------------------------------------
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'RUN_PIPELINE') {
    startDiscovery()
      .then(() => sendResponse({ success: true }))
      .catch((err) => {
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
  }, 150); // Debounce: batch DOM mutations within 150 ms
}

function flushQueue(): void {
  if (pendingQueue.length === 0) return;

  const batch = pendingQueue.splice(0, pendingQueue.length);
  logger.debug(`Flushing ${batch.length} discovered resources to background`);

  chrome.runtime
    .sendMessage({
      action: 'RESOURCES_DISCOVERED',
      data: batch,
    })
    .catch(() => {
      // Background may not be listening yet; silently discard
    });
}
