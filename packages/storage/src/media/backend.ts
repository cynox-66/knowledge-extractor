/**
 * Low-level byte-storage backend for the media store (the only OPFS-aware seam).
 *
 * This SPI hides the concrete storage technology from {@link MediaStore}. It
 * deals purely in backend-relative paths and raw bytes — no media semantics,
 * no metadata, no platform logic. Implementations: `OpfsBlobBackend` (browser),
 * `InMemoryBlobBackend` (tests/fallback), and — later — a Node `fs` backend
 * (desktop) or an object-store backend (cloud), with no change to `MediaStore`.
 */
export interface IMediaBlobBackend {
  /** Writes bytes to a path, creating intermediate directories as needed. */
  write(path: string, bytes: Uint8Array): Promise<void>;
  /** Reads bytes at a path, or null if it does not exist. */
  read(path: string): Promise<Uint8Array | null>;
  /** Whether a file exists at the path. */
  exists(path: string): Promise<boolean>;
  /** Deletes the file at a path. Idempotent (missing path is not an error). */
  delete(path: string): Promise<void>;
  /** Lists all file paths, optionally filtered to those under a prefix. */
  list(prefix?: string): Promise<string[]>;
}

/**
 * In-memory blob backend. Used for tests and as a non-persistent fallback in
 * environments without OPFS. Path semantics mirror the OPFS backend (forward
 * slash separators), so `MediaStore` behaves identically against either.
 */
export class InMemoryBlobBackend implements IMediaBlobBackend {
  private readonly files = new Map<string, Uint8Array>();

  write(path: string, bytes: Uint8Array): Promise<void> {
    // Copy so callers cannot mutate stored bytes after the fact.
    this.files.set(path, bytes.slice());
    return Promise.resolve();
  }

  read(path: string): Promise<Uint8Array | null> {
    const bytes = this.files.get(path);
    return Promise.resolve(bytes ? bytes.slice() : null);
  }

  exists(path: string): Promise<boolean> {
    return Promise.resolve(this.files.has(path));
  }

  delete(path: string): Promise<void> {
    this.files.delete(path);
    return Promise.resolve();
  }

  list(prefix?: string): Promise<string[]> {
    const paths = [...this.files.keys()].filter((p) => !prefix || p.startsWith(prefix));
    return Promise.resolve(paths);
  }
}
