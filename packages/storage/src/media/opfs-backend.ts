import { IMediaBlobBackend } from './backend.js';

/**
 * OPFS-backed blob storage (Origin Private File System).
 *
 * The only module in the platform that touches the File System Access API. It
 * uses the async `createWritable` path (rather than `createSyncAccessHandle`,
 * which is restricted to dedicated workers) so it works in the extension service
 * worker and offscreen document. Paths use `/` separators and are resolved into
 * nested OPFS directories.
 *
 * Availability is gated by {@link OpfsBlobBackend.isSupported}; callers should
 * fall back to `InMemoryBlobBackend` when OPFS is absent.
 */
export class OpfsBlobBackend implements IMediaBlobBackend {
  /** Root subdirectory under the origin's private filesystem. */
  constructor(private readonly rootName = 'ke-media') {}

  static isSupported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      !!navigator.storage &&
      typeof navigator.storage.getDirectory === 'function'
    );
  }

  private async root(): Promise<FileSystemDirectoryHandle> {
    const opfsRoot = await navigator.storage.getDirectory();
    return opfsRoot.getDirectoryHandle(this.rootName, { create: true });
  }

  /** Resolves (optionally creating) the directory holding `path`'s file. */
  private async resolveParent(
    path: string,
    create: boolean,
  ): Promise<{ dir: FileSystemDirectoryHandle; name: string } | null> {
    const segments = path.split('/').filter(Boolean);
    const name = segments.pop();
    if (!name) return null;
    let dir = await this.root();
    for (const segment of segments) {
      try {
        dir = await dir.getDirectoryHandle(segment, { create });
      } catch {
        return null; // missing intermediate directory and create=false
      }
    }
    return { dir, name };
  }

  async write(path: string, bytes: Uint8Array): Promise<void> {
    const parent = await this.resolveParent(path, true);
    if (!parent) throw new Error(`Invalid media path: ${path}`);
    const fileHandle = await parent.dir.getFileHandle(parent.name, { create: true });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(bytes as BufferSource);
    } finally {
      await writable.close();
    }
  }

  async read(path: string): Promise<Uint8Array | null> {
    const parent = await this.resolveParent(path, false);
    if (!parent) return null;
    try {
      const fileHandle = await parent.dir.getFileHandle(parent.name);
      const file = await fileHandle.getFile();
      return new Uint8Array(await file.arrayBuffer());
    } catch {
      return null;
    }
  }

  async exists(path: string): Promise<boolean> {
    const parent = await this.resolveParent(path, false);
    if (!parent) return false;
    try {
      await parent.dir.getFileHandle(parent.name);
      return true;
    } catch {
      return false;
    }
  }

  async delete(path: string): Promise<void> {
    const parent = await this.resolveParent(path, false);
    if (!parent) return;
    try {
      await parent.dir.removeEntry(parent.name);
    } catch {
      // Already absent — idempotent.
    }
  }

  async list(prefix?: string): Promise<string[]> {
    const root = await this.root();
    const paths: string[] = [];
    await this.walk(root, '', paths);
    return prefix ? paths.filter((p) => p.startsWith(prefix)) : paths;
  }

  private async walk(dir: FileSystemDirectoryHandle, prefix: string, out: string[]): Promise<void> {
    // `entries()` is not declared on FileSystemDirectoryHandle in every TS lib
    // version, but the handle is spec-defined to async-iterate [name, handle].
    const entries = dir as unknown as AsyncIterable<[string, FileSystemHandle]>;
    for await (const [name, handle] of entries) {
      const childPath = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === 'directory') {
        await this.walk(handle as FileSystemDirectoryHandle, childPath, out);
      } else {
        out.push(childPath);
      }
    }
  }
}
