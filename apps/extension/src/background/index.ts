/**
 * Background Worker — Pipeline Orchestrator (Alpha Diagnostic Build)
 *
 * Extended with DiagnosticsCollector integration.
 * Every failure is recorded with category, root cause, and DOM snapshot.
 * Sessions export as structured JSON for alpha-report.md population.
 */
import {
  Logger,
  featureFlags,
  FeatureFlag,
  MetricsCollector,
  DiagnosticsCollector,
} from '@knowledge-extractor/shared';
import { InMemoryStorage } from '@knowledge-extractor/storage';
import { InstagramConnector } from '@knowledge-extractor/connector-instagram';
import { IDiscoveredResource } from '@knowledge-extractor/types';

const logger = new Logger('BackgroundWorker');
const storage = new InMemoryStorage();
const connector = new InstagramConnector();
const metrics = new MetricsCollector();
const diagnostics = new DiagnosticsCollector();

// ---- Helpers ----------------------------------------------------------------
function emitEvent(stage: string, data: unknown): void {
  chrome.runtime
    .sendMessage({ action: 'SYSTEM_STATUS', data: { stage, payload: data } })
    .catch(() => {});
}

// ---- Message Dispatcher -----------------------------------------------------
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'START_PIPELINE') {
    handleStartPipeline()
      .then(sendResponse)
      .catch(() => sendResponse({ success: false }));
    return true;
  }

  if (message.action === 'RESOURCES_DISCOVERED') {
    handleDiscoveryBatch(
      message.data as Array<{ resource: IDiscoveredResource; fingerprint: string }>,
    ).catch((err: unknown) => logger.error('Discovery batch error', err));
    return false;
  }

  if (message.action === 'EXPORT_DIAGNOSTICS') {
    handleExportDiagnostics()
      .then(sendResponse)
      .catch(() => sendResponse(null));
    return true;
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

  const pageUrl = tabs[0].url ?? 'unknown';
  diagnostics.reset(pageUrl);

  try {
    await chrome.tabs.sendMessage(tabs[0].id, { action: 'RUN_PIPELINE' });
    emitEvent('PIPELINE_STARTED', { tabId: tabs[0].id, pageUrl });
    return { success: true };
  } catch (err) {
    diagnostics.recordFailure(pageUrl, 'unknown', 'Failed to inject content script', {
      errorDetail: String(err),
    });
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
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tabs[0]?.id) continue;

      const rawResult = (await chrome.tabs.sendMessage(tabs[0].id, {
        action: 'EXTRACT_RESOURCE',
        data: { targetUri: resource.targetUri },
      })) as { success: boolean; data?: unknown; domSnapshot?: string; error?: string } | undefined;

      metrics.addExtractionTime(Date.now() - extractStart);

      if (!rawResult?.success) {
        metrics.recordFailed();
        diagnostics.recordFailure(
          resource.targetUri,
          classifyExtractionError(rawResult?.error),
          rawResult?.error ?? 'Content script returned failure',
          { domSnapshot: rawResult?.domSnapshot },
        );
        emitEvent('EXTRACTION_FAILED', {
          uri: resource.targetUri,
          reason: rawResult?.error,
        });
        continue;
      }

      if (!featureFlags.isEnabled(FeatureFlag.ENABLE_NORMALIZATION)) {
        metrics.recordSkipped();
        continue;
      }

      const normStart = Date.now();
      const normalized = await connector.normalize(
        rawResult.data as Parameters<typeof connector.normalize>[0],
      );
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
      const errorStr = String(err);
      logger.error(`Failed to process resource: ${resource.targetUri}`, err);
      metrics.recordFailed();
      diagnostics.recordFailure(resource.targetUri, classifyExtractionError(errorStr), errorStr, {
        errorDetail: errorStr,
      });
    }
  }

  const snapshot = metrics.snapshot();
  const report = diagnostics.buildReport(snapshot);
  emitEvent('METRICS_SNAPSHOT', snapshot);
  emitEvent('DIAGNOSTICS_SNAPSHOT', report);
}

async function handleExportDiagnostics(): Promise<unknown> {
  const snapshot = metrics.snapshot();
  return diagnostics.buildReport(snapshot);
}

function classifyExtractionError(
  error?: string,
): import('@knowledge-extractor/types').FailureCategory {
  if (!error) return 'unknown';
  const e = error.toLowerCase();
  if (e.includes('selector') || e.includes('queryselector') || e.includes('no article'))
    return 'selector_failure';
  if (e.includes('parse') || e.includes('json') || e.includes('syntax')) return 'parsing_failure';
  if (e.includes('normaliz') || e.includes('resource') || e.includes('contract'))
    return 'normalization_failure';
  if (e.includes('network') || e.includes('fetch') || e.includes('cors')) return 'network_error';
  return 'unknown';
}
