import { Logger } from '@knowledge-extractor/shared';
import { detectSurface, type SurfaceKind } from '@knowledge-extractor/connector-instagram';

/**
 * Live-run smoke harness (P3).
 *
 * The navigation redesign (P0–P2) can only be authoritatively validated against
 * real Instagram, which requires the loaded extension and an authenticated
 * session — something no fixture suite can cover. This harness turns that manual
 * check into an objective, repeatable PASS/FAIL: a developer triggers it on a
 * logged-in surface, it runs one bounded crawl through the real pipeline, and it
 * asserts the three pipeline counters all crossed zero.
 *
 * It is pure orchestration over the existing {@link ISmokeCrawl} and
 * {@link ISmokeMetrics} seams — it never re-implements crawling and owns no
 * Chrome APIs, so it is fully unit-testable with fakes.
 */

/** The crawl surface the harness drives (start) and halts (cancel). */
export interface ISmokeCrawl {
  startCrawl(): Promise<unknown>;
  cancelCrawl(): Promise<void>;
}

/** Read-only view of the canonical pipeline counters. */
export interface ISmokeMetrics {
  snapshot(): { discovered: number; extracted: number; persisted: number };
}

/** One threshold check in a smoke run. */
export interface ISmokeAssertion {
  name: string;
  expected: string;
  actual: number;
  pass: boolean;
}

/** The structured outcome of a smoke run. */
export interface ISmokeReport {
  surface: SurfaceKind;
  url: string;
  durationMs: number;
  timedOut: boolean;
  metrics: { discovered: number; extracted: number; persisted: number };
  assertions: ISmokeAssertion[];
  pass: boolean;
}

export interface ISmokeOptions {
  /** Hard cap on the run (ms). Default 60s. */
  timeoutMs?: number;
  /** Metrics poll interval (ms). Default 1s. */
  pollMs?: number;
}

export class SmokeHarness {
  static readonly DEFAULT_TIMEOUT_MS = 60_000;
  static readonly DEFAULT_POLL_MS = 1_000;

  private readonly logger = new Logger('SmokeHarness');

  constructor(
    private readonly crawl: ISmokeCrawl,
    private readonly metrics: ISmokeMetrics,
    /** Resolves the URL of the surface under test (best-effort; '' tolerated). */
    private readonly getUrl: () => Promise<string>,
  ) {}

  /**
   * Runs one bounded crawl and asserts `discovered`, `extracted`, and
   * `persisted` all crossed zero. Always stops the crawl it started and never
   * throws — failures surface as a report with `pass: false`.
   */
  async run(options: ISmokeOptions = {}): Promise<ISmokeReport> {
    const timeoutMs = options.timeoutMs ?? SmokeHarness.DEFAULT_TIMEOUT_MS;
    const pollMs = options.pollMs ?? SmokeHarness.DEFAULT_POLL_MS;

    const url = await this.getUrl().catch(() => '');
    const surface = detectSurface(url).kind;
    this.logger.info(`Smoke run starting on surface=${surface} (${url})`);

    const startedAt = Date.now();
    let timedOut = false;

    try {
      await this.crawl.startCrawl();

      while (!this.thresholdsMet()) {
        if (Date.now() - startedAt >= timeoutMs) {
          timedOut = true;
          break;
        }
        await this.sleep(pollMs);
      }
    } catch (err) {
      this.logger.error('Smoke run errored while crawling', err);
    } finally {
      await this.crawl.cancelCrawl().catch(() => undefined);
    }

    const report = this.buildReport(surface, url, Date.now() - startedAt, timedOut);
    this.logger.info(
      `Smoke run ${report.pass ? 'PASS' : 'FAIL'} (surface=${surface}, ` +
        `discovered=${report.metrics.discovered}, extracted=${report.metrics.extracted}, ` +
        `persisted=${report.metrics.persisted}, timedOut=${timedOut})`,
    );
    return report;
  }

  private thresholdsMet(): boolean {
    const m = this.metrics.snapshot();
    return m.discovered > 0 && m.extracted > 0 && m.persisted > 0;
  }

  private buildReport(
    surface: SurfaceKind,
    url: string,
    durationMs: number,
    timedOut: boolean,
  ): ISmokeReport {
    const m = this.metrics.snapshot();
    const assertions: ISmokeAssertion[] = [
      { name: 'discovered > 0', expected: '> 0', actual: m.discovered, pass: m.discovered > 0 },
      { name: 'extracted > 0', expected: '> 0', actual: m.extracted, pass: m.extracted > 0 },
      { name: 'persisted > 0', expected: '> 0', actual: m.persisted, pass: m.persisted > 0 },
    ];
    return {
      surface,
      url,
      durationMs,
      timedOut,
      metrics: { discovered: m.discovered, extracted: m.extracted, persisted: m.persisted },
      assertions,
      pass: assertions.every((a) => a.pass),
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
