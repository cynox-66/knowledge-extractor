import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsCollector, DiagnosticsCollector } from '@knowledge-extractor/shared';
import { TaskState } from '@knowledge-extractor/types';
import { SessionManager } from '../src/background/session-manager.js';
import { Scheduler } from '../src/background/scheduler.js';

/**
 * Minimal `chrome.storage` mock. The backing Maps persist for the lifetime of
 * the installed mock, so creating a fresh `SessionManager` against the same mock
 * simulates a browser restart (chrome.storage.local survives restart).
 */
function installChromeMock(): { local: Map<string, unknown>; session: Map<string, unknown> } {
  const local = new Map<string, unknown>();
  const session = new Map<string, unknown>();
  const area = (m: Map<string, unknown>) => ({
    get: (key: string) => Promise.resolve(m.has(key) ? { [key]: m.get(key) } : {}),
    set: (obj: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(obj)) m.set(k, structuredClone(v));
      return Promise.resolve();
    },
  });
  const mock = {
    storage: { local: area(local), session: area(session) },
    runtime: { sendMessage: () => Promise.resolve() },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = mock;
  return { local, session };
}

let areas: { local: Map<string, unknown>; session: Map<string, unknown> };
beforeEach(() => {
  areas = installChromeMock();
});

describe('SessionManager — durable persistence', () => {
  it('persists the session to chrome.storage.local (not session)', async () => {
    const sm = new SessionManager(new MetricsCollector());
    await sm.init();
    sm.startNewSession();
    await sm.update({ currentResource: 'x' });

    expect(areas.local.has('crawl_session')).toBe(true);
    expect(areas.session.size).toBe(0); // nothing written to the volatile area
  });

  it('restores the session on a fresh instance (browser restart)', async () => {
    const first = new SessionManager(new MetricsCollector());
    await first.init();
    const created = first.startNewSession();
    await first.update({ navigationStatus: 'extracting', queueDepth: 5 });

    // Fresh manager over the same persistent storage = restart.
    const second = new SessionManager(new MetricsCollector());
    await second.init();
    const restored = second.getSession();

    expect(restored?.sessionId).toBe(created.sessionId);
    expect(restored?.navigationStatus).toBe('extracting');
    expect(restored?.queueDepth).toBe(5);
  });

  it('rehydrates the canonical metrics from the persisted session', async () => {
    const metrics = new MetricsCollector();
    const first = new SessionManager(metrics);
    await first.init();
    first.startNewSession();
    metrics.recordDiscovered();
    metrics.recordExtracted(100);
    metrics.recordPersisted();
    await first.sync(0); // persist embeds metrics.snapshot()

    const restoredMetrics = new MetricsCollector();
    const second = new SessionManager(restoredMetrics);
    await second.init();

    const snap = restoredMetrics.snapshot();
    expect(snap.discovered).toBe(1);
    expect(snap.extracted).toBe(1);
    expect(snap.persisted).toBe(1);
  });
});

describe('DiagnosticsCollector — snapshot / hydrate', () => {
  it('round-trips failures and strategy usage', () => {
    const d = new DiagnosticsCollector();
    d.reset('https://www.instagram.com/saved');
    d.recordStrategyUsed('SemanticArticleStrategy');
    d.recordStrategyUsed('SemanticArticleStrategy');
    d.recordFailure('uri1', 'parsing_failure', 'boom', { domSnapshot: '<article>x</article>' });

    const snap = d.snapshot();

    const restored = new DiagnosticsCollector();
    restored.hydrate(snap);
    const report = restored.buildReport({
      sessionStart: '',
      sessionEnd: '',
      discovered: 0,
      queued: 0,
      extracted: 0,
      normalized: 0,
      persisted: 0,
      duplicates: 0,
      skipped: 0,
      failed: 0,
      retries: 0,
      navigationFailures: 0,
      extractionFailures: 0,
      normalizationFailures: 0,
      extractionTimeMs: 0,
      normalizationTimeMs: 0,
      navigationTimeMs: 0,
      avgExtractionTime: 0,
      avgNormalizationTime: 0,
      avgNavigationLatency: 0,
      crawlDuration: 0,
      peakQueueSize: 0,
    });

    expect(report.failures).toHaveLength(1);
    expect(report.failures[0].rootCause).toBe('boom');
    expect(report.failures[0].domSnapshot).toBe('<article>x</article>');
    expect(report.strategyUsage['SemanticArticleStrategy']).toBe(2);
    expect(report.pageUrl).toBe('https://www.instagram.com/saved');
  });
});

describe('Scheduler — restore (queue recovery)', () => {
  it('resets in-flight tasks to QUEUED and dedups on restore', () => {
    const original = new Scheduler();
    original.enqueue('https://www.instagram.com/p/a/');
    original.enqueue('https://www.instagram.com/p/b/');
    // Simulate a task that was mid-flight when the worker died.
    const next = original.getNextTask();
    expect(next?.state).toBe(TaskState.OPENING);

    const snapshot = original.snapshot();

    const restored = new Scheduler();
    restored.restore(snapshot);
    // Re-applying the same snapshot must not create duplicates.
    restored.restore(snapshot);

    const all = restored.snapshot();
    expect(all).toHaveLength(2); // no duplicate scheduler entries
    // The previously in-flight task is reclaimable (reset to QUEUED).
    expect(restored.getPendingCount()).toBe(2);
  });
});
