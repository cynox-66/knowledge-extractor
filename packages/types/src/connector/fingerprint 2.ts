/**
 * A deterministic content fingerprint computed before normalization.
 * Used exclusively for duplicate detection within a discovery session.
 * Must not be confused with `IResource.id`, which is a persistent identifier.
 */
export interface IResourceFingerprint {
  /** The hex-encoded fingerprint hash. */
  hash: string;
  /** The fields that were used as fingerprint inputs. */
  inputs: {
    sourceUri?: string;
    authorHandle?: string;
    mediaCount?: number;
    captionPreview?: string;
  };
}
