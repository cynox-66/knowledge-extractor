import {
  IResourceQueryable,
  IMediaStore,
  IControlStateStore,
  IEnrichmentWorkItem,
  IReconciliationReport,
  ResourceState,
} from '@knowledge-extractor/types';
import { Logger } from '@knowledge-extractor/shared';

/** Resources per storage cursor request. Kept small to bound heap usage. */
const PAGE_SIZE = 20;

/**
 * Yields to the browser/worker event loop by deferring via a zero-delay
 * setTimeout. Called between pages so the MV3 service worker is never
 * starved by a long enumeration run.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Runs one paginated reconciliation pass over all {@link ResourceState.HYDRATED}
 * resources, resolving each resource's media metadata from the {@link IMediaStore}.
 *
 * ### MV3 safety
 * The loop yields to the event loop between every storage page via a
 * zero-delay `setTimeout`, preventing the service worker from being terminated
 * for excessive synchronous CPU work.
 *
 * ### Crawl-loop independence
 * This class is read-only with respect to IndexedDB: it opens a separate
 * readonly cursor transaction per page and never writes. It is therefore
 * completely non-contending with the {@link CrawlController} write path.
 *
 * ### Phase contract
 * Reconciled {@link IEnrichmentWorkItem}s are delivered to the injected
 * `onWorkItem` callback. In Phase 4 this callback will be replaced by the
 * OCR engine; in Phase 3 it defaults to a no-op.
 */
export class EnrichmentLoop {
  static readonly ALARM_NAME = 'ke-enrichment-tick';

  private readonly logger = new Logger('EnrichmentLoop');
  private _active = false;
  private _passInProgress = false;
  private _intervalMinutes = 5;

  constructor(
    private readonly queryable: IResourceQueryable,
    private readonly mediaStore: IMediaStore,
    private readonly onWorkItem: (item: IEnrichmentWorkItem) => Promise<void> = async () => {},
    private readonly controlStateStore?: IControlStateStore,
  ) {}

  /**
   * Activates the self-scheduling loop. Runs the first pass immediately and
   * schedules a `chrome.alarms` watchdog after each clean completion so the
   * loop survives MV3 service worker suspension. Idempotent: repeated calls
   * before the first pass completes are ignored.
   */
  start(intervalMinutes = 5): void {
    if (this._active) return;
    this._active = true;
    this._intervalMinutes = intervalMinutes;
    this._trigger();
  }

  /**
   * Deactivates the loop. Any in-flight pass runs to completion but no further
   * alarm is created afterwards. Clears any pending alarm immediately.
   */
  stop(): void {
    this._active = false;
    void chrome.alarms.clear(EnrichmentLoop.ALARM_NAME);
  }

  /**
   * Called by the alarm listener in `index.ts` when `ALARM_NAME` fires.
   * Triggers the next pass unless one is already in progress.
   */
  handleAlarm(): void {
    this._trigger();
  }

  /**
   * Executes one complete reconciliation pass and returns a structured report.
   *
   * This method never throws: if an unhandled error occurs it is captured into
   * the report (`completedCleanly: false`, `error` populated) so that startup
   * wiring can log it without a top-level unhandled-rejection.
   */
  async runPass(): Promise<IReconciliationReport> {
    const startedAt = new Date().toISOString();
    let resourcesEnumerated = 0;
    let resourcesReady = 0;
    let resourcesWithMissingMedia = 0;
    let resourcesSkipped = 0;
    let resourcesFailed = 0;
    let completedCleanly = false;
    let errorMessage: string | undefined;

    try {
      // Recover cursor from durable state so the pass resumes after an MV3
      // service worker eviction rather than restarting from the beginning.
      let cursor: string | undefined =
        (await this.controlStateStore?.getCrawlState<string>('enrichment_cursor')) ?? undefined;

      do {
        const page = await this.queryable.queryResources({
          state: ResourceState.HYDRATED,
          pageSize: PAGE_SIZE,
          ...(cursor !== undefined ? { cursor } : {}),
        });

        for (const resource of page.items) {
          resourcesEnumerated++;

          // Pre-condition: media capture must be flagged complete. Resources
          // that are HYDRATED but whose capture did not fully commit are not
          // yet ready for enrichment — defer to a later pass.
          if (!resource.completeness.media) {
            resourcesSkipped++;
            continue;
          }

          const resolvedMedia: IEnrichmentWorkItem['resolvedMedia'] = {};
          let hasMissingMedia = false;

          for (const mediaItem of resource.media) {
            const metadata = await this.mediaStore.getMetadata(mediaItem.id);
            if (metadata !== null) {
              resolvedMedia[mediaItem.id] = metadata;
            } else {
              hasMissingMedia = true;
              this.logger.warn(`Blob absent for media ${mediaItem.id} on resource ${resource.id}`);
            }
          }

          // Emit to the downstream handler regardless of missing blobs.
          // The handler (stub in Phase 3; OCR engine in Phase 4) decides whether
          // to process partially-resolved items or defer them.
          // Per-item isolation: a handler failure increments resourcesFailed and
          // continues so a single bad item never aborts the entire pass.
          try {
            await this.onWorkItem({ resource, resolvedMedia });
            if (hasMissingMedia) {
              resourcesWithMissingMedia++;
            } else {
              resourcesReady++;
            }
          } catch (itemErr) {
            resourcesFailed++;
            this.logger.error(`Work item handler failed for resource ${resource.id}`, itemErr);
          }
        }

        // Checkpoint once per page — after all items in the page have been
        // attempted — so an evicted service worker resumes from the next page
        // rather than re-processing the current one.
        const lastPageItemId = page.items.at(-1)?.id;
        if (lastPageItemId !== undefined && this.controlStateStore !== undefined) {
          await this.controlStateStore.saveCrawlState('enrichment_cursor', lastPageItemId);
        }

        cursor = page.hasMore ? page.nextCursor : undefined;

        // Yield between pages — never on the final page.
        if (page.hasMore) {
          await yieldToEventLoop();
        }
      } while (cursor !== undefined);

      // Clear the checkpoint: the pass completed without eviction.
      await this.controlStateStore?.deleteCrawlState('enrichment_cursor');

      completedCleanly = true;
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error('Enrichment pass failed', err);
    }

    return {
      startedAt,
      completedAt: new Date().toISOString(),
      resourcesEnumerated,
      resourcesReady,
      resourcesWithMissingMedia,
      resourcesSkipped,
      resourcesFailed,
      completedCleanly,
      ...(errorMessage !== undefined ? { error: errorMessage } : {}),
    };
  }

  /**
   * Runs the pass if the loop is active and no pass is currently in flight.
   * On clean completion, creates the next `chrome.alarms` watchdog so the
   * loop self-reschedules across MV3 service worker suspensions.
   */
  private _trigger(): void {
    if (!this._active || this._passInProgress) return;
    this._passInProgress = true;
    this.runPass()
      .then((report) => {
        this._passInProgress = false;
        if (report.completedCleanly && this._active) {
          chrome.alarms.create(EnrichmentLoop.ALARM_NAME, {
            delayInMinutes: this._intervalMinutes,
          });
        }
      })
      .catch((err) => {
        this._passInProgress = false;
        this.logger.error('Enrichment pass unexpectedly threw', err);
      });
  }
}
