/**
 * Background Worker — Pipeline Orchestrator (Alpha Diagnostic Build)
 */
import { Logger, MetricsCollector, DiagnosticsCollector } from '@knowledge-extractor/shared';
import { IDiscoveredResource } from '@knowledge-extractor/types';
import { CrawlController } from './crawl-controller';

const logger = new Logger('BackgroundWorker');
const metrics = new MetricsCollector();
const diagnostics = new DiagnosticsCollector();
const controller = new CrawlController(metrics, diagnostics);

// Initialize controller and session
controller.init().catch((err) => logger.error('Failed to init controller', err));

// ---- Message Dispatcher -----------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'START_PIPELINE') {
    controller
      .startCrawl()
      .then((session) => sendResponse({ success: true, session }))
      .catch(() => sendResponse({ success: false }));
    return true;
  }

  if (message.action === 'PAUSE_PIPELINE') {
    controller.pauseCrawl().then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.action === 'RESUME_PIPELINE') {
    controller.resumeCrawl().then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.action === 'CANCEL_PIPELINE') {
    controller.cancelCrawl().then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.action === 'GET_SESSION') {
    const sessionManager = (controller as any).sessionManager;
    sendResponse(sessionManager?.getSession() || null);
    return false;
  }

  if (message.action === 'RESOURCES_DISCOVERED') {
    controller
      .handleDiscoveryBatch(
        message.data as Array<{ resource: IDiscoveredResource; fingerprint: string }>,
      )
      .catch((err) => logger.error('Discovery batch error', err));
    return false;
  }

  if (message.action === 'EXPORT_DIAGNOSTICS') {
    const report = diagnostics.buildReport(metrics.snapshot());
    sendResponse(report);
    return false;
  }
});
