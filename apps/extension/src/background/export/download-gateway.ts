/**
 * Download delivery seam for the export subsystem.
 *
 * The {@link ExportWriter} produces a finished artifact (a {@link Blob}) but must
 * not know *how* it reaches the user — that is browser-runtime infrastructure.
 * This small interface is the seam (mirroring `ICaptureTransport` in
 * media-capture.ts): the writer depends on the abstraction; the composition root
 * injects the concrete {@link ChromeDownloadGateway}. Tests inject a fake.
 */
export interface IDownloadGateway {
  /** Hands a finished artifact to the user under the given filename. */
  deliver(content: Blob, filename: string): Promise<void>;
}

/**
 * Production gateway backed by `chrome.downloads`.
 *
 * MV3 note: a service worker has no `URL.createObjectURL` and no `FileReader`,
 * so a Blob URL cannot be minted here. We instead encode the artifact as a
 * base64 `data:` URL, which `chrome.downloads.download` accepts from a worker.
 * Encoding is chunked to avoid blowing the call stack on large artifacts
 * (`String.fromCharCode(...wholeBuffer)` overflows for big inputs). This holds
 * the artifact in memory twice during delivery — the documented memory ceiling
 * (architecture risk R3); a streaming sink can replace this gateway later.
 */
export class ChromeDownloadGateway implements IDownloadGateway {
  async deliver(content: Blob, filename: string): Promise<void> {
    const buffer = new Uint8Array(await content.arrayBuffer());
    const base64 = encodeBase64(buffer);
    const mime = content.type || 'application/octet-stream';
    const dataUrl = `data:${mime};base64,${base64}`;

    await chrome.downloads.download({
      url: dataUrl,
      filename,
      saveAs: false,
    });
  }
}

/** Standard base64 alphabet, encoded without `btoa` so it is worker-safe. */
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Encodes bytes as base64. Implemented directly (rather than via `btoa` over a
 * binary string) so it is safe in any worker context and never builds an
 * intermediate megabyte-scale string via `String.fromCharCode(...)`.
 */
export function encodeBase64(bytes: Uint8Array): string {
  let result = '';
  const len = bytes.length;
  let i = 0;
  for (; i + 2 < len; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    result +=
      BASE64_CHARS[(n >>> 18) & 63] +
      BASE64_CHARS[(n >>> 12) & 63] +
      BASE64_CHARS[(n >>> 6) & 63] +
      BASE64_CHARS[n & 63];
  }
  // Tail: 1 or 2 remaining bytes with '=' padding.
  const remaining = len - i;
  if (remaining === 1) {
    const n = bytes[i] << 16;
    result += BASE64_CHARS[(n >>> 18) & 63] + BASE64_CHARS[(n >>> 12) & 63] + '==';
  } else if (remaining === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    result +=
      BASE64_CHARS[(n >>> 18) & 63] +
      BASE64_CHARS[(n >>> 12) & 63] +
      BASE64_CHARS[(n >>> 6) & 63] +
      '=';
  }
  return result;
}
