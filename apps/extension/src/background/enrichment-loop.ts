import {
  IResourceQueryable,
  IMediaStore,
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
  private readonly logger = new Logger('EnrichmentLoop');

  constructor(
    private readonly queryable: IResourceQueryable,
    private readonly mediaStore: IMediaStore,
    private readonly onWorkItem: (item: IEnrichmentWorkItem) => Promise<void> = async () => {},
  ) {}

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
      let cursor: string | undefined;

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

        cursor = page.hasMore ? page.nextCursor : undefined;

        // Yield between pages — never on the final page.
        if (page.hasMore) {
          await yieldToEventLoop();
        }
      } while (cursor !== undefined);

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
}
