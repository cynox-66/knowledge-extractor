import { IRawSourceResource } from '@knowledge-extractor/types';

/**
 * The layout classification of an Instagram post as determined by the Parser.
 *
 * Instagram-specific. This intentionally lives inside the Instagram connector
 * and must NOT leak into `@knowledge-extractor/types` (the platform-agnostic
 * engine layer).
 */
export type InstagramPostLayout = 'single-image' | 'carousel' | 'reel' | 'unknown';

/**
 * The normalized intermediate output of the Instagram Parser.
 * The Parser understands Instagram's DOM; the Connector understands platform contracts.
 * This is the boundary between them.
 *
 * Extends the platform-agnostic `IRawSourceResource` so the connector can satisfy
 * the generic `IConnector<TRaw>` contract.
 */
export interface IInstagramParsedPost extends IRawSourceResource {
  /** The detected layout type of the post. */
  layout: InstagramPostLayout;
  /**
   * For carousels, each slide's media URI in order.
   * Overlaps with `mediaUris` but maintains explicit carousel semantics.
   */
  slideUris?: string[];
  /**
   * For reels, the video source URI.
   */
  videoUri?: string;
  /** The author's display name if extractable. */
  authorDisplayName?: string;
  /** ISO 8601 parsed from the post timestamp element. */
  publishedAt?: string;
}
