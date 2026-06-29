import { Logger } from '@knowledge-extractor/shared';
import {
  IMediaStore,
  IMediaRetentionPolicy,
  IResourceQueryable,
  IControlStateStore,
  ResourceState,
  MediaType,
} from '@knowledge-extractor/types';

const RESOURCE_PAGE_SIZE = 200;
const YIELD_EVERY_N_EVICTIONS = 50;
const DEFAULT_INTERVAL_MINUTES = 30;

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export interface IJanitorReport {
  startedAt: string;
  completedAt: string;
  totalBytesBeforeEviction: number;
  totalBytesAfterEviction: number;
  mediaInspected: number;
  mediaEvicted: number;
  bytesFreed: number;
  skippedNotEnriched: number;
  skippedPinned: number;
  skippedVideo: number;
  skippedUnderCap: boolean;
  completedCleanly: boolean;
  error?: string;
}

/**
 * MV3-safe, alarm-driven retention enforcer for IMediaStore.
 *
 * Eviction invariant (never violated):
 *   A blob is evictable ONLY when its parent resource is ENRICHED or EXPORTED
 *   AND the resource is not user-pinned.
 *
 * This is the only component that deletes media for capacity reasons.
 */
export class MediaJanitor {
  static readonly ALARM_NAME = 'media-janitor';

  private readonly logger = new Logger('MediaJanitor');
  private _passInProgress = false;
  private _intervalMinutes = DEFAULT_INTERVAL_MINUTES;

  constructor(
    private readonly mediaStore: IMediaStore,
    private readonly queryable: IResourceQueryable,
    private readonly policy: IMediaRetentionPolicy,
    private readonly controlStore?: IControlStateStore,
  ) {}

  /**
   * Registers the periodic alarm. Called once from the composition root during
   * startup. Idempotent: a second call resets the interval.
   */
  schedule(intervalMinutes = DEFAULT_INTERVAL_MINUTES): void {
    this._intervalMinutes = intervalMinutes;
    chrome.alarms.create(MediaJanitor.ALARM_NAME, { delayInMinutes: intervalMinutes });
    this.logger.info(`MediaJanitor scheduled (interval=${intervalMinutes}m)`);
  }

  /** Called by the composition-root alarm dispatcher. */
  handleAlarm(): void {
    this._trigger();
  }

  private _trigger(): void {
    if (this._passInProgress) return;
    this._passInProgress = true;

    this.runPass()
      .then((report) => {
        this._passInProgress = false;
        this.logger.info(
          `Janitor pass complete: evicted=${report.mediaEvicted} freed=${report.bytesFreed}B ` +
            `clean=${report.completedCleanly}`,
        );
        chrome.alarms.create(MediaJanitor.ALARM_NAME, {
          delayInMinutes: this._intervalMinutes,
        });
      })
      .catch((err) => {
        this._passInProgress = false;
        this.logger.error('MediaJanitor pass unexpectedly threw', err);
        // Always reschedule — a permanent stop would leave storage unbounded.
        chrome.alarms.create(MediaJanitor.ALARM_NAME, {
          delayInMinutes: this._intervalMinutes,
        });
      });
  }

  /**
   * Executes one retention pass. Bounded work per activation — safe for MV3.
   * Yields to the event loop every YIELD_EVERY_N_EVICTIONS deletions so the
   * service worker is never blocked for long.
   */
  async runPass(): Promise<IJanitorReport> {
    const startedAt = new Date().toISOString();
    let mediaInspected = 0;
    let mediaEvicted = 0;
    let bytesFreed = 0;
    let skippedNotEnriched = 0;
    let skippedPinned = 0;
    let skippedVideo = 0;
    let skippedUnderCap = false;
    let completedCleanly = false;
    let totalBytesBeforeEviction = 0;
    let totalBytesAfterEviction = 0;
    let errorMessage: string | undefined;

    try {
      // ── 1. Honour 'keep' policy — no eviction at all ─────────────────────
      if (this.policy.fullMediaMode === 'keep') {
        this.logger.info('Retention policy=keep; no eviction performed');
        return {
          startedAt,
          completedAt: new Date().toISOString(),
          totalBytesBeforeEviction: 0,
          totalBytesAfterEviction: 0,
          mediaInspected: 0,
          mediaEvicted: 0,
          bytesFreed: 0,
          skippedNotEnriched: 0,
          skippedPinned: 0,
          skippedVideo: 0,
          skippedUnderCap: false,
          completedCleanly: true,
        };
      }

      // ── 2. Check whether we exceed the cap ───────────────────────────────
      const stats = await this.mediaStore.statistics();
      totalBytesBeforeEviction = stats.totalBytes;
      totalBytesAfterEviction = stats.totalBytes;

      const maxBytes = this.policy.maxCacheBytes ?? Infinity;
      if (stats.totalBytes <= maxBytes) {
        this.logger.info(
          `Cache within cap (${stats.totalBytes}/${maxBytes === Infinity ? '∞' : maxBytes} B); skipping`,
        );
        skippedUnderCap = true;
        completedCleanly = true;
        return {
          startedAt,
          completedAt: new Date().toISOString(),
          totalBytesBeforeEviction,
          totalBytesAfterEviction,
          mediaInspected: 0,
          mediaEvicted: 0,
          bytesFreed: 0,
          skippedNotEnriched: 0,
          skippedPinned: 0,
          skippedVideo: 0,
          skippedUnderCap,
          completedCleanly,
        };
      }

      const bytesToFree = stats.totalBytes - maxBytes;

      // ── 3. Build eligible set: mediaId → resourceId ──────────────────────
      //    A blob is eligible only when its parent is ENRICHED or EXPORTED.
      //    Any mediaId absent from this map belongs to a pre-enrichment resource
      //    and must not be evicted — this is the invariant enforcement point.
      const eligibleMedia = new Map<string, string>(); // mediaId → resourceId

      for (const state of [ResourceState.ENRICHED, ResourceState.EXPORTED] as const) {
        let cursor: string | undefined;
        do {
          const page = await this.queryable.queryResources({
            state,
            pageSize: RESOURCE_PAGE_SIZE,
            ...(cursor !== undefined ? { cursor } : {}),
          });
          for (const resource of page.items) {
            for (const media of resource.media) {
              eligibleMedia.set(media.id, resource.id);
            }
          }
          cursor = page.hasMore ? page.nextCursor : undefined;
          if (page.hasMore) {
            await yieldToEventLoop();
          }
        } while (cursor !== undefined);
      }

      // ── 4. Load pinned resource IDs ───────────────────────────────────────
      const pinnedArray = this.controlStore
        ? await this.controlStore.getCrawlState<string[]>('pinned_resource_ids')
        : null;
      const pinnedResourceIds = new Set<string>(pinnedArray ?? []);

      // ── 5. Gather all media metadata and sort by lastAccess ASC (LRU) ────
      const allMedia = await this.mediaStore.list();
      allMedia.sort((a, b) => a.lastAccess.localeCompare(b.lastAccess));

      // ── 6. Evict in LRU order until we free enough bytes ─────────────────
      let evictionCount = 0;
      for (const meta of allMedia) {
        if (bytesFreed >= bytesToFree) break;

        mediaInspected++;

        // Skip video when the policy retains video
        if (this.policy.retainVideo && meta.type === MediaType.VIDEO) {
          skippedVideo++;
          continue;
        }

        // Eviction invariant: parent must be ENRICHED or EXPORTED
        const resourceId = eligibleMedia.get(meta.id);
        if (resourceId === undefined) {
          skippedNotEnriched++;
          continue;
        }

        // Skip blobs whose parent resource is user-pinned
        if (pinnedResourceIds.has(resourceId)) {
          skippedPinned++;
          continue;
        }

        // Safe to evict — per-item error isolation; a single failure does not
        // abort the pass so the remaining candidates are still processed.
        try {
          await this.mediaStore.delete(meta.id);
          bytesFreed += meta.sizeBytes;
          mediaEvicted++;
          evictionCount++;
        } catch (deleteErr) {
          this.logger.warn(`Failed to evict media ${meta.id}`, deleteErr);
        }

        if (evictionCount > 0 && evictionCount % YIELD_EVERY_N_EVICTIONS === 0) {
          await yieldToEventLoop();
        }
      }

      totalBytesAfterEviction = Math.max(0, totalBytesBeforeEviction - bytesFreed);
      completedCleanly = true;
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error('MediaJanitor pass failed', err);
    }

    return {
      startedAt,
      completedAt: new Date().toISOString(),
      totalBytesBeforeEviction,
      totalBytesAfterEviction,
      mediaInspected,
      mediaEvicted,
      bytesFreed,
      skippedNotEnriched,
      skippedPinned,
      skippedVideo,
      skippedUnderCap,
      completedCleanly,
      ...(errorMessage !== undefined ? { error: errorMessage } : {}),
    };
  }
}
