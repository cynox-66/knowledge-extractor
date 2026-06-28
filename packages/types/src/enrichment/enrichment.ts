import { IResource } from '../core/resource.js';
import { IMediaMetadata } from '../storage/media.js';

/**
 * A reconciled unit of enrichment work produced by the enrichment loop.
 *
 * The loop pairs each {@link IResource} from a storage page with the
 * {@link IMediaMetadata} for each of its declared media assets.  An absent
 * key in {@link resolvedMedia} means the corresponding blob is missing from
 * the media store (evicted by the browser, never written, or corrupted).
 * Consumers decide independently whether to skip, defer, or re-fetch missing
 * blobs — this interface carries no policy.
 */
export interface IEnrichmentWorkItem {
  /** The resource waiting for enrichment. */
  resource: IResource;
  /**
   * Resolved metadata for each media asset in {@link resource.media}, keyed
   * by {@link IMedia.id}.  Missing keys indicate blobs absent from the store.
   */
  resolvedMedia: Record<string, IMediaMetadata>;
}

/**
 * A structured summary produced at the end of one enrichment reconciliation
 * pass over a page of {@link IResource} objects.
 *
 * Provides the metrics needed to:
 *  - track enrichment progress in the diagnostics layer,
 *  - detect when large numbers of OPFS blobs have been evicted,
 *  - decide whether to continue to the next page or yield to the event loop.
 */
export interface IReconciliationReport {
  /** ISO 8601 timestamp when this pass began. */
  startedAt: string;
  /** ISO 8601 timestamp when this pass completed or was interrupted. */
  completedAt: string;
  /** Total resources enumerated from storage during this pass. */
  resourcesEnumerated: number;
  /**
   * Resources whose every declared media asset resolved successfully in the
   * media store and are therefore ready for the next enrichment stage (e.g. OCR).
   */
  resourcesReady: number;
  /**
   * Resources that had one or more media blobs absent from the media store.
   * These are not failed — they may be retried in a later pass.
   */
  resourcesWithMissingMedia: number;
  /**
   * Resources skipped because they did not satisfy enrichment pre-conditions
   * (e.g. wrong lifecycle state, or `completeness.media` is false).
   */
  resourcesSkipped: number;
  /** `true` if the pass ran to completion without an unhandled error. */
  completedCleanly: boolean;
  /** Populated with the error message when {@link completedCleanly} is `false`. */
  error?: string;
}
