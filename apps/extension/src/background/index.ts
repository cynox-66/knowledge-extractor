/**
 * Background Worker — Composition Root.
 *
 * This module is the ONLY place that constructs infrastructure (storage engine,
 * media store, metrics, diagnostics, connector, controller). Every subsystem
 * receives its dependencies by constructor injection; controllers never build
 * infrastructure themselves.
 *
 * MV3 service worker: all event listeners are registered synchronously at the
 * top level (before any `await`) so the revived worker never misses an event.
 * Asynchronous startup (persistence request + recovery) runs afterwards.
 */
import { Logger, MetricsCollector, DiagnosticsCollector } from '@knowledge-extractor/shared';
import { IDiscoveredResource, IStorageEngine, IMediaStore } from '@knowledge-extractor/types';
import { CrawlController } from './crawl-controller.js';
import { InstagramConnector } from '@knowledge-extractor/connector-instagram';
import {
  IndexedDbStorageEngine,
  InMemoryStorage,
  MediaStore,
  OpfsBlobBackend,
  InMemoryBlobBackend,
} from '@knowledge-extractor/storage';

const logger = new Logger('BackgroundWorker');
const metrics = new MetricsCollector();
const diagnostics = new DiagnosticsCollector();
const connector = new InstagramConnector();

// Durable resource storage. IndexedDB is the default; in the rare environment
// where it is unavailable, degrade to volatile in-memory storage (with a clear
// warning) so the crawler still functions — persistence failures then surface
// as recorded task failures rather than silent data loss.
const storage: IStorageEngine =
  typeof indexedDB !== 'undefined' ? new IndexedDbStorageEngine() : new InMemoryStorage();
if (typeof indexedDB === 'undefined') {
  logger.warn('IndexedDB unavailable — using volatile in-memory storage');
}

// Durable media store (bytes in OPFS). Falls back to a volatile in-memory blob
// backend where OPFS is unavailable. Owned here; consumed by later phases.
const mediaStore: IMediaStore = new MediaStore(
  OpfsBlobBackend.isSupported() ? new OpfsBlobBackend() : new InMemoryBlobBackend(),
);
if (!OpfsBlobBackend.isSupported()) {
  logger.warn('OPFS unavailable — media store using volatile in-memory backend');
}

const controller = new CrawlController(metrics, diagnostics, connector, storage, mediaStore);

/** Requests durable (non-evictable) storage. Best-effort; safe if unsupported. */
async function requestPersistence(): Promise<void> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
      const granted = await navigator.storage.persist();
      logger.info(`Persistent storage ${granted ? 'granted' : 'denied'}`);
    } else {
      logger.warn('navigator.storage.persist() unavailable');
    }
  } catch (err) {
    logger.warn('Persistence request failed', err);
  }
}

/** Async startup: request persistence, probe storage, then recover state. */
async function startup(): Promise<void> {
  await requestPersistence();
  // Probe durable storage so a hard failure (quota/corruption) is visible in
  // diagnostics instead of silently failing every later persistence.
  try {
    await storage.getResourceById('__startup_probe__');
  } catch (err) {
    logger.error('Durable storage probe failed — resources may not persist', err);
    diagnostics.recordFailure('storage', 'unknown', 'Durable storage unavailable at startup', {
      errorDetail: String(err),
    });
  }
  await controller.init();
}

startup().catch((err) => logger.error('Startup failed', err));

// ---- Watchdog: resume the processing loop after SW suspension ---------------
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CrawlController.ALARM_NAME) {
    controller.resumeFromAlarm().catch((err) => logger.error('Alarm resume failed', err));
  }
});

// ---- Message Dispatcher -----------------------------------------------------
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
    sendResponse(controller.getSession());
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
    sendResponse(controller.exportDiagnostics());
    return false;
  }

  return false;
});
