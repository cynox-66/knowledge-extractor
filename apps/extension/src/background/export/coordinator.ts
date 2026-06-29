import {
  ExportTarget,
  type IResourceQueryable,
  type IMediaStore,
  type IControlStateStore,
  type ISerializer,
  type IExportRequest,
  type IExportProgress,
  type IExportResult,
} from '@knowledge-extractor/types';
import { project } from '@knowledge-extractor/export';
import { Logger } from '@knowledge-extractor/shared';
import type { ExportWriter, ExportArtifactMode } from './writer.js';

/** Resources read per storage page. Small, to bound per-tick heap (R2). */
const PAGE_SIZE = 20;

/** Control-state keys. App-local opaque records — not Layer-0 contracts. */
const PROGRESS_KEY = 'export_progress';
const REQUEST_KEY = 'export_request';

/** Outcome of a non-blocking {@link ExportCoordinator.start}. */
export interface IExportStartResult {
  accepted: boolean;
  requestId: string | null;
  /** Populated when `accepted` is false. */
  reason?: string;
}

/** Yields to the worker event loop between pages so the SW is never starved. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function generateRequestId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `export-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * MV3-safe export orchestrator (Layer 4).
 *
 * Drives the read-only export pipeline: page resources via {@link IResourceQueryable},
 * build a media-presence set from {@link IMediaStore}, run the pure `project()` +
 * the selected pure {@link ISerializer}, stream the resulting parts to the
 * {@link ExportWriter}, and persist {@link IExportProgress} for resumability and UI.
 *
 * ### Concurrency / duplicate protection
 * A single in-memory `_activeRun` latch (set synchronously before the first
 * `await`) guarantees no two exports overlap and rejects duplicate requests.
 *
 * ### MV3 lifecycle / resumability
 * The pass is a self-yielding loop; a `chrome.alarms` watchdog is re-armed each
 * page and disarmed on completion. If the service worker is suspended mid-export
 * the frozen loop cannot continue, but the watchdog later fires and
 * {@link resume} re-drives the interrupted request to completion. Because the
 * in-memory artifact buffer does not survive suspension, resume restarts artifact
 * assembly from the beginning of the dataset — never delivering a truncated file.
 * Export is read-only and idempotent (ADR-013), so a clean re-run is safe and
 * never produces a duplicate download (the interrupted attempt never delivered).
 *
 * ### Purity
 * The coordinator is the only component here that touches infrastructure.
 * `project()` and the serializers remain pure; binary bytes are resolved by the
 * writer, never by this class or the pure layer.
 */
export class ExportCoordinator {
  static readonly ALARM_NAME = 'ke-export-tick';

  private readonly logger = new Logger('ExportCoordinator');
  private _activeRun = false;
  private _cancelRequested = false;

  constructor(
    private readonly queryable: IResourceQueryable,
    private readonly mediaStore: IMediaStore,
    private readonly controlStore: IControlStateStore,
    private readonly serializers: ReadonlyMap<ExportTarget, ISerializer>,
    private readonly writer: ExportWriter,
  ) {}

  /**
   * Non-blocking entry point for the message dispatcher. Synchronously latches
   * against duplicates, launches the export in the background, and returns
   * immediately so the UI can poll progress. Never throws.
   */
  start(request: IExportRequest): IExportStartResult {
    if (this._activeRun) {
      return { accepted: false, requestId: null, reason: 'An export is already in progress' };
    }
    if (!this.serializers.has(request.target)) {
      return { accepted: false, requestId: null, reason: `No serializer for ${request.target}` };
    }
    const requestId = generateRequestId();
    void this.runExport(request, requestId).catch((err) => {
      this.logger.error('Export run failed', err);
    });
    return { accepted: true, requestId };
  }

  /**
   * Runs one complete export to completion and returns its result. Sets the
   * duplicate latch synchronously (before the first await). Throws if an export
   * is already active or the target has no serializer. Primarily the awaitable
   * core used by {@link start} and by tests.
   */
  async runExport(
    request: IExportRequest,
    requestId = generateRequestId(),
  ): Promise<IExportResult> {
    if (this._activeRun) {
      throw new Error('An export is already in progress');
    }
    const serializer = this.serializers.get(request.target);
    if (serializer === undefined) {
      throw new Error(`No serializer registered for target ${request.target}`);
    }

    this._activeRun = true;
    this._cancelRequested = false;

    try {
      return await this._drive(request, requestId, serializer);
    } finally {
      this._activeRun = false;
      this._disarmWatchdog();
    }
  }

  /**
   * Watchdog recovery. Invoked from the alarm listener. If no run is active and
   * a persisted export is unfinished, re-drives it to completion. A no-op when a
   * run is already in flight or nothing is pending.
   */
  async resume(): Promise<void> {
    if (this._activeRun) return;

    const progress = await this.controlStore.getCrawlState<IExportProgress>(PROGRESS_KEY);
    if (progress === null || progress.done) {
      this._disarmWatchdog();
      return;
    }
    const request = await this.controlStore.getCrawlState<IExportRequest>(REQUEST_KEY);
    if (request === null) {
      // Progress without a request is unrecoverable — clear it.
      await this._clearPersistedState();
      this._disarmWatchdog();
      return;
    }

    this.logger.info(`Resuming interrupted export ${progress.requestId}`);
    await this.runExport(request, progress.requestId);
  }

  /** Requests cancellation of the active export (checked between pages). */
  cancel(): void {
    this._cancelRequested = true;
  }

  /** Called by the alarm listener in the composition root. */
  handleAlarm(): void {
    void this.resume().catch((err) => this.logger.error('Export resume failed', err));
  }

  /** Reads the persisted progress record for the UI. */
  getProgress(): Promise<IExportProgress | null> {
    return this.controlStore.getCrawlState<IExportProgress>(PROGRESS_KEY);
  }

  // -- internals -------------------------------------------------------------

  private async _drive(
    request: IExportRequest,
    requestId: string,
    serializer: ISerializer,
  ): Promise<IExportResult> {
    const startedAt = new Date().toISOString();
    const mode: ExportArtifactMode = request.target === ExportTarget.JSON ? 'single-file' : 'zip';

    // Persist the request so a watchdog resume after SW eviction can reconstruct
    // it (IExportProgress alone does not carry state/inclusion).
    await this.controlStore.saveCrawlState(REQUEST_KEY, request);

    this.writer.begin();
    this._armWatchdog();

    let resourcesWritten = 0;
    let mediaQueued = 0;
    let cursor: string | undefined;

    do {
      const page = await this.queryable.queryResources({
        state: request.state,
        pageSize: PAGE_SIZE,
        ...(cursor !== undefined ? { cursor } : {}),
      });

      for (const resource of page.items) {
        // Per-item isolation: one bad resource must never abort the export.
        try {
          const presentMediaIds = await this._buildPresenceSet(resource.media, request.media);
          const item = project(resource, presentMediaIds, request.media);
          const parts = serializer.serializeItem(item);

          for (const part of parts) {
            if (part.kind === 'text' && part.text !== undefined) {
              this.writer.appendText(part.path, part.text);
            } else if (part.kind === 'binary' && part.mediaId !== undefined) {
              this.writer.writeBinary(part.path, part.mediaId);
              mediaQueued++;
            }
          }
          resourcesWritten++;
        } catch (err) {
          this.logger.error(`Failed to export resource ${resource.id}`, err);
        }
      }

      // Checkpoint progress once per page (cursor + counts) for UI + resumability.
      const lastId = page.items.at(-1)?.id;
      await this._persistProgress({
        requestId,
        target: request.target,
        resourcesWritten,
        mediaWritten: mediaQueued,
        startedAt,
        done: false,
        ...(lastId !== undefined ? { cursor: lastId } : {}),
      });
      this._armWatchdog(); // heartbeat: keep the watchdog pointed ~1 min ahead

      if (this._cancelRequested) {
        this.logger.info(`Export ${requestId} cancelled`);
        await this._clearPersistedState();
        return this._buildResult(requestId, request.target, resourcesWritten, 0, 0, 0, startedAt);
      }

      cursor = page.hasMore ? page.nextCursor : undefined;
      if (page.hasMore) {
        await yieldToEventLoop();
      }
    } while (cursor !== undefined);

    // Assemble + deliver the artifact. The writer resolves binary bytes here.
    const filename = buildFilename(request.target, mode);
    const written = await this.writer.finalize(mode, filename);

    await this._persistProgress({
      requestId,
      target: request.target,
      resourcesWritten,
      mediaWritten: written.mediaIncluded,
      startedAt,
      done: true,
    });

    return this._buildResult(
      requestId,
      request.target,
      resourcesWritten,
      written.mediaIncluded,
      written.mediaMissing,
      written.bytes,
      startedAt,
    );
  }

  /**
   * Builds the set of media ids whose blobs are present, used by the projector
   * to assign `localPath` consistently with what the writer will write. Skipped
   * entirely for `inclusion === 'none'`, which never links local blobs.
   */
  private async _buildPresenceSet(
    media: ReadonlyArray<{ id: string }>,
    inclusion: IExportRequest['media'],
  ): Promise<ReadonlySet<string>> {
    if (inclusion === 'none' || media.length === 0) return EMPTY_SET;
    const present = new Set<string>();
    for (const m of media) {
      if (await this.mediaStore.exists(m.id)) {
        present.add(m.id);
      }
    }
    return present;
  }

  private _persistProgress(progress: Omit<IExportProgress, 'updatedAt'>): Promise<void> {
    const record: IExportProgress = { ...progress, updatedAt: new Date().toISOString() };
    return this.controlStore.saveCrawlState(PROGRESS_KEY, record);
  }

  private async _clearPersistedState(): Promise<void> {
    await this.controlStore.deleteCrawlState(PROGRESS_KEY);
    await this.controlStore.deleteCrawlState(REQUEST_KEY);
  }

  private _buildResult(
    requestId: string,
    target: ExportTarget,
    resourcesExported: number,
    mediaIncluded: number,
    mediaMissing: number,
    bytes: number,
    _startedAt: string,
  ): IExportResult {
    return {
      requestId,
      target,
      resourcesExported,
      mediaIncluded,
      mediaMissing,
      bytes,
      completedAt: new Date().toISOString(),
    };
  }

  private _armWatchdog(): void {
    if (typeof chrome !== 'undefined' && chrome.alarms) {
      chrome.alarms.create(ExportCoordinator.ALARM_NAME, { delayInMinutes: 1 });
    }
  }

  private _disarmWatchdog(): void {
    if (typeof chrome !== 'undefined' && chrome.alarms) {
      void chrome.alarms.clear(ExportCoordinator.ALARM_NAME);
    }
  }
}

const EMPTY_SET: ReadonlySet<string> = new Set<string>();

/** Deterministic-prefix, timestamped artifact filename. */
function buildFilename(target: ExportTarget, mode: ExportArtifactMode): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const ext = mode === 'single-file' ? 'ndjson' : 'zip';
  return `knowledge-export-${target}-${stamp}.${ext}`;
}
