import { MediaType } from '../core/media.js';

/**
 * Lifecycle state of a stored blob, used for crash/partial-write detection.
 * A blob is only readable once its metadata sidecar reaches `complete`.
 */
export type MediaBlobState = 'writing' | 'complete';

/**
 * Durable metadata describing a single stored media blob. Kept small and
 * queryable; the binary itself lives in the blob backend (OPFS in the browser).
 *
 * Dimensions (width/height/duration) are intentionally absent: deriving them
 * requires decoding the media, which is an enrichment concern, not a storage one.
 */
export interface IMediaMetadata {
  /** Globally unique media id (matches `IMedia.id`). Primary key. */
  id: string;
  /** Standardized classification — drives directory routing and statistics. */
  type: MediaType;
  /** MIME type, so reads can return a correctly-typed `Blob`. */
  mimeType: string;
  /** Size of the stored blob in bytes — quota accounting and corruption checks. */
  sizeBytes: number;
  /** SHA-256 hex digest of the bytes — deduplication and corruption detection. */
  hash: string;
  /** Backend-relative path to the blob; decouples the id from the layout. */
  storagePath: string;
  /** Commit marker. Only `complete` blobs are returned by `get`. */
  state: MediaBlobState;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** ISO 8601 timestamp of the last successful read (future LRU cleanup). */
  lastAccess: string;
  /** The original provider URI the bytes came from, for provenance. */
  source?: string;
}

/** Input accepted by {@link IMediaStore.put}. */
export interface IMediaPutInput {
  /** The media id to store under (typically `IMedia.id`). */
  id: string;
  /** The binary payload. */
  bytes: Blob | Uint8Array;
  /** Classification used for directory routing and statistics. */
  type: MediaType;
  /** MIME type; defaults to `application/octet-stream` if omitted. */
  mimeType?: string;
  /** Optional provenance (the original `sourceUri`). */
  source?: string;
}

/** Aggregate statistics for the media store. */
export interface IMediaStoreStatistics {
  /** Total number of completed blobs. */
  count: number;
  /** Sum of `sizeBytes` across completed blobs. */
  totalBytes: number;
  /** Per-`MediaType` blob counts. */
  countByType: Record<string, number>;
  /** Per-`MediaType` byte totals. */
  bytesByType: Record<string, number>;
  /** Browser storage estimate, when available (`navigator.storage.estimate`). */
  quota?: { usage: number; quota: number };
}

/** Result of a {@link IMediaStore.cleanup} run. */
export interface ICleanupResult {
  /** Blobs removed because they had no completed metadata sidecar. */
  orphanedBlobs: number;
  /** Metadata sidecars removed because their blob was missing. */
  orphanedMetadata: number;
  /** Temporary/in-progress artifacts removed. */
  temporary: number;
}

/**
 * Platform-independent media persistence contract.
 *
 * Stores and retrieves binary media keyed by id, with durable metadata. It is
 * connector-agnostic (no Instagram or any platform logic) and
 * implementation-agnostic (the backend — OPFS today, filesystem or cloud later —
 * is hidden). Consumers (e.g. the future OCR stage) interact only through this
 * interface and never touch storage APIs directly.
 */
export interface IMediaStore {
  /** Persists bytes and returns their durable metadata. Atomic per id. */
  put(input: IMediaPutInput): Promise<IMediaMetadata>;
  /** Returns the stored blob, or null if absent/incomplete. Updates lastAccess. */
  get(id: string): Promise<Blob | null>;
  /** Returns metadata without reading the blob, or null if absent. */
  getMetadata(id: string): Promise<IMediaMetadata | null>;
  /** Whether a completed blob exists for the id. */
  exists(id: string): Promise<boolean>;
  /** Removes the blob and its metadata. Idempotent. */
  delete(id: string): Promise<void>;
  /** Lists metadata for all completed blobs. */
  list(): Promise<IMediaMetadata[]>;
  /** Aggregate store statistics. */
  statistics(): Promise<IMediaStoreStatistics>;
  /** Recomputes the hash and verifies it against stored metadata. */
  verify(id: string): Promise<boolean>;
  /** Removes orphaned blobs, orphaned metadata, and temporary artifacts. */
  cleanup(): Promise<ICleanupResult>;
}
