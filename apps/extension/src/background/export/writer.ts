import type { IMediaStore } from '@knowledge-extractor/types';
import { Logger } from '@knowledge-extractor/shared';
import { buildZip, type IZipEntry } from './zip-writer.js';
import type { IDownloadGateway } from './download-gateway.js';

/**
 * How the accumulated parts are assembled into the final artifact.
 *  - `single-file`: all text concatenated into one file (NDJSON).
 *  - `zip`: every text + binary part becomes one archive entry (markdown).
 */
export type ExportArtifactMode = 'single-file' | 'zip';

/** Stats returned by {@link ExportWriter.finalize}. */
export interface IExportWriterResult {
  /** Size of the delivered artifact in bytes. */
  bytes: number;
  /** Binary parts whose bytes were resolved and written. */
  mediaIncluded: number;
  /** Binary parts whose bytes were absent at write time (skipped). */
  mediaMissing: number;
}

const SINGLE_FILE_MIME = 'application/x-ndjson';
const ZIP_MIME = 'application/zip';
const textEncoder = new TextEncoder();

/**
 * Concrete export sink (Layer 4).
 *
 * Responsibilities and boundaries:
 *  - Accumulates the pure serializer output: text parts are appended by path
 *    (this is how NDJSON grows into one file); binary parts are recorded by path
 *    and written exactly once.
 *  - **Owns binary byte resolution.** Serializers and the projector never touch
 *    `IMediaStore`; the writer resolves `mediaId → bytes` here, at finalize time,
 *    so bytes never flow through the pure layer and memory stays bounded until
 *    assembly.
 *  - Assembles a single file or a ZIP and hands it to the injected
 *    {@link IDownloadGateway}. It never calls `chrome.*` directly.
 *
 * A single instance is owned by the composition root and reused across exports;
 * {@link begin} clears state so runs never bleed into one another. The
 * coordinator guarantees no two exports overlap, so the buffers have a single
 * writer at a time.
 */
export class ExportWriter {
  private readonly logger = new Logger('ExportWriter');

  /** path → accumulated text (append-by-path). */
  private textParts = new Map<string, string>();
  /** path → mediaId (binary written once per path). */
  private binaryParts = new Map<string, string>();

  constructor(
    private readonly mediaStore: IMediaStore,
    private readonly downloadGateway: IDownloadGateway,
  ) {}

  /** Resets all accumulated state for a fresh export run. */
  begin(): void {
    this.textParts = new Map();
    this.binaryParts = new Map();
  }

  /** Appends text to the part at `path`, creating it on first write. */
  appendText(path: string, text: string): void {
    const existing = this.textParts.get(path);
    this.textParts.set(path, existing !== undefined ? existing + text : text);
  }

  /** Records a binary part to be resolved from {@link IMediaStore} at finalize. */
  writeBinary(path: string, mediaId: string): void {
    this.binaryParts.set(path, mediaId);
  }

  /**
   * Assembles the accumulated parts into the final artifact and delivers it via
   * the download gateway. Returns artifact size and media resolution counts.
   */
  async finalize(mode: ExportArtifactMode, filename: string): Promise<IExportWriterResult> {
    if (mode === 'single-file') {
      return this.finalizeSingleFile(filename);
    }
    return this.finalizeZip(filename);
  }

  private async finalizeSingleFile(filename: string): Promise<IExportWriterResult> {
    // NDJSON yields exactly one text path; concatenate defensively (sorted) in
    // case a future single-file target emits more than one.
    const paths = [...this.textParts.keys()].sort();
    const text = paths.map((p) => this.textParts.get(p) ?? '').join('');
    const bytes = textEncoder.encode(text);
    const blob = new Blob([bytes as BlobPart], { type: SINGLE_FILE_MIME });

    await this.downloadGateway.deliver(blob, filename);

    return { bytes: bytes.length, mediaIncluded: 0, mediaMissing: 0 };
  }

  private async finalizeZip(filename: string): Promise<IExportWriterResult> {
    const entries: IZipEntry[] = [];

    for (const [path, text] of this.textParts) {
      entries.push({ path, bytes: textEncoder.encode(text) });
    }

    let mediaIncluded = 0;
    let mediaMissing = 0;
    for (const [path, mediaId] of this.binaryParts) {
      // Writer-owned byte resolution. A blob present at projection time can be
      // absent now (e.g. evicted by the janitor between presence check and
      // write); degrade gracefully by skipping rather than aborting the export.
      const blob = await this.mediaStore.get(mediaId);
      if (blob === null) {
        mediaMissing++;
        this.logger.warn(`Media ${mediaId} absent at write time — skipping ${path}`);
        continue;
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      entries.push({ path, bytes });
      mediaIncluded++;
    }

    // Deterministic archive ordering.
    entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

    const archive = buildZip(entries);
    const blob = new Blob([archive as BlobPart], { type: ZIP_MIME });

    await this.downloadGateway.deliver(blob, filename);

    return { bytes: archive.length, mediaIncluded, mediaMissing };
  }
}
