import { IResourceFingerprint } from '@knowledge-extractor/types';

/**
 * Computes a deterministic fingerprint for a raw Instagram DOM node
 * to facilitate deduplication before normalization.
 *
 * Uses a simple, synchronous djb2-style hash since we operate in a content
 * script context and cannot use the Web Crypto API without async overhead.
 */
export class ResourceFingerprinter {
  fingerprint(inputs: IResourceFingerprint['inputs']): IResourceFingerprint {
    const raw = [
      inputs.sourceUri ?? '',
      inputs.authorHandle ?? '',
      String(inputs.mediaCount ?? 0),
      (inputs.captionPreview ?? '').slice(0, 64),
    ].join('|');

    const hash = this.djb2(raw);
    return { hash, inputs };
  }

  private djb2(str: string): string {
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }
}
