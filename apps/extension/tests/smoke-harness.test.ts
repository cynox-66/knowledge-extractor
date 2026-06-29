import { describe, it, expect } from 'vitest';
import {
  SmokeHarness,
  type ISmokeCrawl,
  type ISmokeMetrics,
} from '../src/background/smoke-harness.js';

/** A crawl whose metrics ramp to the target after `crossesAfter` polls. */
function fakeCrawl(): ISmokeCrawl & { started: boolean; cancelled: boolean } {
  return {
    started: false,
    cancelled: false,
    startCrawl() {
      this.started = true;
      return Promise.resolve({});
    },
    cancelCrawl() {
      this.cancelled = true;
      return Promise.resolve();
    },
  };
}

/** Metrics that report `counts` after `crossesAfter` snapshots, else zeros. */
function rampingMetrics(crossesAfter: number): ISmokeMetrics {
  let calls = 0;
  return {
    snapshot() {
      calls += 1;
      return calls > crossesAfter
        ? { discovered: 5, extracted: 4, persisted: 3 }
        : { discovered: 0, extracted: 0, persisted: 0 };
    },
  };
}

const url = async (): Promise<string> => 'https://www.instagram.com/dev/saved/all-posts/';

describe('SmokeHarness (P3)', () => {
  it('PASSes once all three counters cross zero, and stops the crawl', async () => {
    const crawl = fakeCrawl();
    const harness = new SmokeHarness(crawl, rampingMetrics(1), url);

    const report = await harness.run({ timeoutMs: 2000, pollMs: 5 });

    expect(report.pass).toBe(true);
    expect(report.timedOut).toBe(false);
    expect(report.surface).toBe('grid');
    expect(report.metrics).toEqual({ discovered: 5, extracted: 4, persisted: 3 });
    expect(report.assertions.every((a) => a.pass)).toBe(true);
    expect(crawl.started).toBe(true);
    expect(crawl.cancelled).toBe(true); // always halts what it started
  });

  it('FAILs with timedOut when counters never cross', async () => {
    const crawl = fakeCrawl();
    const stuck: ISmokeMetrics = {
      snapshot: () => ({ discovered: 0, extracted: 0, persisted: 0 }),
    };
    const harness = new SmokeHarness(crawl, stuck, url);

    const report = await harness.run({ timeoutMs: 30, pollMs: 5 });

    expect(report.pass).toBe(false);
    expect(report.timedOut).toBe(true);
    expect(report.assertions.map((a) => a.pass)).toEqual([false, false, false]);
    expect(crawl.cancelled).toBe(true);
  });

  it('reports a partial failure (extraction stuck) per assertion', async () => {
    const crawl = fakeCrawl();
    const partial: ISmokeMetrics = {
      snapshot: () => ({ discovered: 9, extracted: 0, persisted: 0 }),
    };
    const harness = new SmokeHarness(crawl, partial, url);

    const report = await harness.run({ timeoutMs: 30, pollMs: 5 });

    expect(report.pass).toBe(false);
    expect(report.assertions[0]).toMatchObject({ name: 'discovered > 0', pass: true });
    expect(report.assertions[1]).toMatchObject({ name: 'extracted > 0', pass: false });
  });
});
