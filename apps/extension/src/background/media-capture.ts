import {
  IResource,
  IMedia,
  IMediaStore,
  MediaType,
  ResourceState,
} from '@knowledge-extractor/types';
import { Logger } from '@knowledge-extractor/shared';

/** Per-media outcome reported by the content script after fetching bytes. */
export interface ICapturedMedia {
  id: string;
  bytes: ArrayBuffer;
  mimeType: string;
  sizeBytes: number;
  source: string;
}

/** Per-media error reported by the content script. */
export interface ICaptureError {
  id: string;
  error: string;
}

/** Response shape returned by the content script's `CAPTURE_MEDIA` handler. */
export interface ICaptureResponse {
  success: boolean;
  captured: ICapturedMedia[];
  failed: ICaptureError[];
}

/** A single capture failure recorded by the coordinator (per media item). */
export interface IMediaCaptureFailure {
  mediaId: string;
  sourceUri: string;
  reason: string;
}

/** Aggregate outcome of capturing all media for a single resource. */
export interface ICaptureOutcome {
  /** The resource with `localUri` filled in on each captured media item. */
  resource: IResource;
  /** Number of media items successfully captured and persisted. */
  persisted: number;
  /** Number of media items skipped (videos / inline / no source URI). */
  skipped: number;
  /** Per-failed-item details for diagnostics. */
  failures: IMediaCaptureFailure[];
}

/** Transport used to ask the content script to fetch media bytes. */
export interface ICaptureTransport {
  capture(
    items: Array<{ id: string; sourceUri: string; type: MediaType; mimeType?: string }>,
  ): Promise<ICaptureResponse>;
}

/** Hard cap on per-blob size (bytes). Larger items are skipped + diagnosed. */
const MAX_BYTES = 20 * 1024 * 1024;

/**
 * Drives media hydration for one resource.
 *
 * Pipeline position: after normalization, before resource persistence.
 * Responsibility: ask the content script (the only context with the
 * authenticated session) to fetch each `IMedia.sourceUri`, persist the bytes
 * via `IMediaStore`, attach the resulting storage path as `IMedia.localUri`,
 * and — when every present media item lands — promote `ResourceState` to
 * `HYDRATED`. Carousel children (depth 1) are hydrated recursively.
 *
 * The coordinator never decides _which_ URLs to fetch — that came from
 * extraction. It only orchestrates the fetch + persist + state transition.
 * It owns no chrome APIs (the transport does), so it is unit-testable.
 *
 * Idempotency: on a retried task the coordinator re-captures and re-writes
 * via `MediaStore.put` (which overwrites on the same id). Re-persistence of
 * `IResource` is similarly idempotent at the storage layer.
 */
export class MediaCaptureCoordinator {
  private readonly logger = new Logger('MediaCapture');

  constructor(
    private readonly transport: ICaptureTransport,
    private readonly mediaStore: IMediaStore,
  ) {}

  /**
   * Captures every applicable media item on `resource` (and its children),
   * persisting bytes and stamping `localUri`. Returns the mutated resource and
   * an outcome record for the controller / diagnostics. Does not throw on
   * per-item failures; a fully-empty-but-needed capture surfaces via
   * `outcome.persisted === 0 && outcome.failures.length > 0` so the controller
   * can decide whether to treat the whole task as a capture failure.
   */
  async hydrate(resource: IResource): Promise<ICaptureOutcome> {
    const outcome: ICaptureOutcome = {
      resource,
      persisted: 0,
      skipped: 0,
      failures: [],
    };

    await this.hydrateInPlace(resource, outcome);

    // Children recurse (carousels). The parent's `media[]` and each child's
    // media must all have landed for the parent to be HYDRATED.
    let childMediaCompleteness = true;
    if (resource.children && resource.children.length > 0) {
      for (const child of resource.children) {
        await this.hydrateInPlace(child, outcome);
        if (!child.completeness.media) childMediaCompleteness = false;
        // A child resource is HYDRATED only if all of its own media landed.
        if (child.media.length > 0 && child.completeness.media) {
          child.state = ResourceState.HYDRATED;
        }
      }
    }

    const parentMediaComplete = resource.completeness.media && childMediaCompleteness;
    // Promote the top resource only if every item we attempted actually landed.
    // An EXTRACTED-only resource with no media stays EXTRACTED (no media to hydrate).
    if (parentMediaComplete && this.hasAnyMedia(resource)) {
      resource.state = ResourceState.HYDRATED;
    }

    this.logger.info(
      `Hydrated ${resource.id}: persisted=${outcome.persisted} skipped=${outcome.skipped} failed=${outcome.failures.length}`,
    );
    return outcome;
  }

  /** Captures and persists media owned directly by a single resource node. */
  private async hydrateInPlace(node: IResource, outcome: ICaptureOutcome): Promise<void> {
    const candidates = node.media.filter((m) => this.isFetchable(m));
    // Items we deliberately don't capture this milestone (videos, data:/blob:,
    // missing sourceUri) count as "skipped" — they do not block HYDRATED status
    // for items that *are* captured, but they do mark `completeness.media =
    // false` because the resource isn't fully materialized.
    const deferred = node.media.filter((m) => !this.isFetchable(m));
    outcome.skipped += deferred.length;
    if (deferred.length > 0) {
      node.completeness = { ...node.completeness, media: false };
    }

    if (candidates.length === 0) {
      // No fetchable media on this node. If the original media[] was empty, the
      // resource is fully accounted for; otherwise it's partial.
      if (node.media.length === 0) {
        node.completeness = { ...node.completeness, media: true };
      }
      return;
    }

    const response = await this.transport.capture(
      candidates.map((m) => ({
        id: m.id,
        sourceUri: m.sourceUri,
        type: m.type,
        ...(m.mimeType ? { mimeType: m.mimeType } : {}),
      })),
    );

    const failuresById = new Map(response.failed.map((f) => [f.id, f]));
    const capturedById = new Map(response.captured.map((c) => [c.id, c]));

    let allOk = candidates.length > 0;

    for (const media of candidates) {
      const captured = capturedById.get(media.id);
      if (!captured) {
        const reason = failuresById.get(media.id)?.error ?? 'No bytes returned';
        outcome.failures.push({ mediaId: media.id, sourceUri: media.sourceUri, reason });
        allOk = false;
        continue;
      }
      if (captured.sizeBytes > MAX_BYTES) {
        outcome.failures.push({
          mediaId: media.id,
          sourceUri: media.sourceUri,
          reason: `Media too large (${captured.sizeBytes} bytes > cap ${MAX_BYTES})`,
        });
        allOk = false;
        continue;
      }
      try {
        const meta = await this.mediaStore.put({
          id: media.id,
          bytes: new Uint8Array(captured.bytes),
          type: media.type,
          mimeType: captured.mimeType || media.mimeType || 'application/octet-stream',
          source: media.sourceUri,
        });
        media.localUri = meta.storagePath;
        media.mimeType = meta.mimeType;
        media.sizeBytes = meta.sizeBytes;
        outcome.persisted++;
      } catch (err) {
        outcome.failures.push({
          mediaId: media.id,
          sourceUri: media.sourceUri,
          reason: err instanceof Error ? err.message : String(err),
        });
        allOk = false;
      }
    }

    // `completeness.media` is true only if every media item on this node has a
    // `localUri` AND no item was deferred above.
    const everyItemLanded = node.media.every((m) => !!m.localUri);
    node.completeness = {
      ...node.completeness,
      media: deferred.length === 0 && allOk && everyItemLanded,
    };
  }

  /** Whether an `IMedia` item is a Beta-1 capture candidate. */
  private isFetchable(m: IMedia): boolean {
    if (!m.sourceUri) return false;
    if (m.type === MediaType.VIDEO) return false; // deferred to a later milestone
    if (m.sourceUri.startsWith('data:') || m.sourceUri.startsWith('blob:')) return false;
    return true;
  }

  private hasAnyMedia(resource: IResource): boolean {
    if (resource.media.length > 0) return true;
    return !!resource.children?.some((c) => c.media.length > 0);
  }
}
