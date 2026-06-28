import {
  IMediaStore,
  IMediaMetadata,
  IMediaPutInput,
  IMediaStoreStatistics,
  ICleanupResult,
  MediaType,
} from '@knowledge-extractor/types';
import { Logger } from '@knowledge-extractor/shared';
import { IMediaBlobBackend } from './backend.js';

/**
 * Backend-relative directory layout. Blobs are routed by media type; metadata
 * sidecars live under `meta/`; `tmp/` is reserved for future streaming writes.
 * `thumbnails/` and `cache/` are reserved names for later phases (not yet used).
 */
const LAYOUT = {
  ROOT: 'media',
  META: 'media/meta',
  TMP: 'media/tmp',
  // Reserved for future phases — declared for a stable layout, not yet written.
  THUMBNAILS: 'media/thumbnails',
  CACHE: 'media/cache',
} as const;

function typeDir(type: MediaType): string {
  switch (type) {
    case MediaType.IMAGE:
      return 'images';
    case MediaType.VIDEO:
      return 'videos';
    case MediaType.AUDIO:
      return 'audio';
    case MediaType.DOCUMENT:
      return 'documents';
    default:
      return 'other';
  }
}

function blobPath(id: string, type: MediaType): string {
  return `${LAYOUT.ROOT}/${typeDir(type)}/${id}`;
}

function metaPath(id: string): string {
  return `${LAYOUT.META}/${id}.json`;
}

async function toBytes(input: Blob | Uint8Array): Promise<Uint8Array> {
  if (input instanceof Uint8Array) return input;
  return new Uint8Array(await input.arrayBuffer());
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Connector-independent, OPFS-independent media persistence.
 *
 * Owns directory layout, metadata sidecars, content hashing, crash-consistency,
 * and statistics. It never references a storage API directly — all bytes flow
 * through an injected {@link IMediaBlobBackend}, so the same logic runs over
 * OPFS (browser), memory (tests), or a future filesystem/cloud backend.
 *
 * **Crash consistency:** a blob is committed by writing its metadata sidecar
 * *after* the bytes. A blob with no `complete` sidecar (or a sidecar with no
 * blob) is an orphan removed by {@link cleanup}. Blob writes themselves are
 * atomic at the backend level (OPFS `createWritable` replaces the file on close).
 *
 * A lazily-built in-memory index over the sidecars keeps `list`/`statistics`
 * fast; it is the runtime cache, not the source of truth (the sidecars are).
 */
export class MediaStore implements IMediaStore {
  private readonly logger = new Logger('MediaStore');
  private index: Map<string, IMediaMetadata> | null = null;

  constructor(private readonly backend: IMediaBlobBackend) {}

  async put(input: IMediaPutInput): Promise<IMediaMetadata> {
    const index = await this.ensureIndex();
    const bytes = await toBytes(input.bytes);
    const hash = await sha256Hex(bytes);
    const path = blobPath(input.id, input.type);
    const now = new Date().toISOString();

    // 1. Write bytes (atomic at the backend). 2. Commit via the metadata sidecar.
    await this.backend.write(path, bytes);
    const metadata: IMediaMetadata = {
      id: input.id,
      type: input.type,
      mimeType: input.mimeType ?? 'application/octet-stream',
      sizeBytes: bytes.byteLength,
      hash,
      storagePath: path,
      state: 'complete',
      createdAt: index.get(input.id)?.createdAt ?? now,
      lastAccess: now,
      ...(input.source ? { source: input.source } : {}),
    };
    await this.writeMetadata(metadata);
    index.set(input.id, metadata);
    this.logger.debug(`Stored media ${input.id} (${bytes.byteLength} bytes)`);
    return metadata;
  }

  async get(id: string): Promise<Blob | null> {
    const index = await this.ensureIndex();
    const metadata = index.get(id);
    if (!metadata || metadata.state !== 'complete') return null;
    const bytes = await this.backend.read(metadata.storagePath);
    if (!bytes) return null;
    // lastAccess is updated in the runtime cache only (avoids a write per read);
    // durable persistence of lastAccess arrives with LRU cleanup in a later phase.
    metadata.lastAccess = new Date().toISOString();
    return new Blob([bytes as BlobPart], { type: metadata.mimeType });
  }

  async getMetadata(id: string): Promise<IMediaMetadata | null> {
    const index = await this.ensureIndex();
    const metadata = index.get(id);
    return metadata ? { ...metadata } : null;
  }

  async exists(id: string): Promise<boolean> {
    const index = await this.ensureIndex();
    return index.get(id)?.state === 'complete';
  }

  async delete(id: string): Promise<void> {
    const index = await this.ensureIndex();
    const metadata = index.get(id);
    if (metadata) {
      await this.backend.delete(metadata.storagePath);
    }
    await this.backend.delete(metaPath(id));
    index.delete(id);
  }

  async list(): Promise<IMediaMetadata[]> {
    const index = await this.ensureIndex();
    return [...index.values()].map((m) => ({ ...m }));
  }

  async statistics(): Promise<IMediaStoreStatistics> {
    const index = await this.ensureIndex();
    const stats: IMediaStoreStatistics = {
      count: 0,
      totalBytes: 0,
      countByType: {},
      bytesByType: {},
    };
    for (const m of index.values()) {
      stats.count++;
      stats.totalBytes += m.sizeBytes;
      stats.countByType[m.type] = (stats.countByType[m.type] ?? 0) + 1;
      stats.bytesByType[m.type] = (stats.bytesByType[m.type] ?? 0) + m.sizeBytes;
    }
    const quota = await this.estimateQuota();
    if (quota) stats.quota = quota;
    return stats;
  }

  async verify(id: string): Promise<boolean> {
    const index = await this.ensureIndex();
    const metadata = index.get(id);
    if (!metadata) return false;
    const bytes = await this.backend.read(metadata.storagePath);
    if (!bytes) return false;
    if (bytes.byteLength !== metadata.sizeBytes) return false;
    return (await sha256Hex(bytes)) === metadata.hash;
  }

  async cleanup(): Promise<ICleanupResult> {
    const result: ICleanupResult = { orphanedBlobs: 0, orphanedMetadata: 0, temporary: 0 };
    const allPaths = await this.backend.list(LAYOUT.ROOT);

    // Read every sidecar to learn the authoritative set of blob paths.
    const sidecarPaths = allPaths.filter((p) => p.startsWith(`${LAYOUT.META}/`));
    const knownBlobPaths = new Set<string>();
    for (const sidecar of sidecarPaths) {
      const metadata = await this.readMetadata(sidecar);
      if (metadata && metadata.state === 'complete') {
        knownBlobPaths.add(metadata.storagePath);
        // Orphaned metadata: sidecar references a blob that no longer exists.
        if (!(await this.backend.exists(metadata.storagePath))) {
          await this.backend.delete(sidecar);
          result.orphanedMetadata++;
        }
      } else {
        // Incomplete or unreadable sidecar — drop it.
        await this.backend.delete(sidecar);
        result.orphanedMetadata++;
      }
    }

    for (const path of allPaths) {
      if (path.startsWith(`${LAYOUT.TMP}/`)) {
        await this.backend.delete(path);
        result.temporary++;
      } else if (
        !path.startsWith(`${LAYOUT.META}/`) &&
        path.startsWith(`${LAYOUT.ROOT}/`) &&
        !knownBlobPaths.has(path)
      ) {
        // A blob with no completed sidecar — orphan from an interrupted put.
        await this.backend.delete(path);
        result.orphanedBlobs++;
      }
    }

    this.index = null; // force rebuild after structural changes
    return result;
  }

  // ---- internals -----------------------------------------------------------

  private async ensureIndex(): Promise<Map<string, IMediaMetadata>> {
    if (this.index) return this.index;
    const index = new Map<string, IMediaMetadata>();
    const sidecars = await this.backend.list(`${LAYOUT.META}/`);
    for (const sidecar of sidecars) {
      const metadata = await this.readMetadata(sidecar);
      if (metadata && metadata.state === 'complete') {
        index.set(metadata.id, metadata);
      }
    }
    this.index = index;
    return index;
  }

  private async writeMetadata(metadata: IMediaMetadata): Promise<void> {
    const bytes = new TextEncoder().encode(JSON.stringify(metadata));
    await this.backend.write(metaPath(metadata.id), bytes);
  }

  private async readMetadata(path: string): Promise<IMediaMetadata | null> {
    const bytes = await this.backend.read(path);
    if (!bytes) return null;
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as IMediaMetadata;
    } catch {
      return null; // corrupt sidecar
    }
  }

  private async estimateQuota(): Promise<{ usage: number; quota: number } | undefined> {
    if (
      typeof navigator !== 'undefined' &&
      navigator.storage &&
      typeof navigator.storage.estimate === 'function'
    ) {
      const estimate = await navigator.storage.estimate();
      return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
    }
    return undefined;
  }
}
