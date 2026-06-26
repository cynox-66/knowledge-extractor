/**
 * Background Worker — Pipeline Orchestrator
 *
 * Receives discovery batches from the Content Script, runs normalization
 * through the InstagramConnector, persists to InMemoryStorage, and emits
 * domain events to the Popup UI.
 *
 * This worker is completely ignorant of the Instagram DOM.
 */
import { Logger, featureFlags, FeatureFlag, MetricsCollector } from '@knowledge-extractor/shared';
import { InMemoryStorage } from '@knowledge-extractor/storage';
import { InstagramConnector } from '@knowledge-extractor/connector-instagram';
import { IDiscoveredResource } from '@knowledge-extractor/types';

const logger = new Logger('BackgroundWorker');
const storage = new InMemoryStorage();
const connector = new InstagramConnector();
const metrics = new MetricsCollector();

// ---- Helpers ----------------------------------------------------------------
function emitEvent(stage: string, data: unknown): void {
  chrome.runtime
    .sendMessage({ action: 'SYSTEM_STATUS', data: { stage, payload: data } })
    .catch(() => {});
}

// ---- Message Dispatcher -----------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'START_PIPELINE') {
    handleStartPipeline().then(sendResponse);
    return true;
  }

  if (message.action === 'RESOURCES_DISCOVERED') {
    handleDiscoveryBatch(message.data).catch((err) => logger.error('Discovery batch error', err));
    return false;
  }
});

// ---- Pipeline stages --------------------------------------------------------
async function handleStartPipeline(): Promise<{ success: boolean }> {
  metrics.reset();
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]?.id) {
    logger.error('No active tab');
    return { success: false };
  }

  try {
    await chrome.tabs.sendMessage(tabs[0].id, { action: 'RUN_PIPELINE' });
    emitEvent('PIPELINE_STARTED', { tabId: tabs[0].id });
    return { success: true };
  } catch (err) {
    logger.error('Failed to reach content script', err);
    return { success: false };
  }
}

async function handleDiscoveryBatch(
  batch: Array<{ resource: IDiscoveredResource; fingerprint: string }>,
): Promise<void> {
  if (!featureFlags.isEnabled(FeatureFlag.ENABLE_EXTRACTION)) {
    logger.warn('Extraction disabled by feature flag');
    batch.forEach(() => metrics.recordSkipped());
    return;
  }

  emitEvent('DISCOVERY_BATCH', { count: batch.length });

  for (const { resource } of batch) {
    const extractStart = Date.now();

    try {
      // We delegate to the connector which owns the article in its own DOM
      // context.  For the background worker we inject a tab script to get
      // the article element and pass the parsed representation back.
      // For Sprint 3 we ask the content script to extract a specific URI.
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tabs[0]?.id) continue;

      const rawResult = await chrome.tabs.sendMessage(tabs[0].id, {
        action: 'EXTRACT_RESOURCE',
        data: { targetUri: resource.targetUri },
      });

      metrics.addExtractionTime(Date.now() - extractStart);

      if (!rawResult?.success) {
        metrics.recordFailed();
        continue;
      }

      if (!featureFlags.isEnabled(FeatureFlag.ENABLE_NORMALIZATION)) {
        metrics.recordSkipped();
        continue;
      }

      const normStart = Date.now();
      const normalized = await connector.normalize(rawResult.data);
      metrics.addNormalizationTime(Date.now() - normStart);
      metrics.recordExtracted();

      emitEvent('RESOURCE_NORMALIZED', normalized);

      if (featureFlags.isEnabled(FeatureFlag.ENABLE_STORAGE)) {
        const tx = await storage.beginTransaction();
        await storage.saveResource(normalized, tx);
        await tx.commit();
        emitEvent('RESOURCE_STORED', { id: normalized.id });
      }
    } catch (err) {
      logger.error(`Failed to process resource: ${resource.targetUri}`, err);
      metrics.recordFailed();
    }
  }

  emitEvent('METRICS_SNAPSHOT', metrics.snapshot());
}
