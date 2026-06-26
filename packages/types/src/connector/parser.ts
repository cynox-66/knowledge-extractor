import { IRawSourceResource } from './pipeline.js';

/**
 * The layout classification of an Instagram post as determined by the Parser.
 */
export type InstagramPostLayout = 'single-image' | 'carousel' | 'reel' | 'unknown';

/**
 * The normalized intermediate output of the Instagram Parser.
 * The Parser understands Instagram's DOM; the Connector understands platform contracts.
 * This is the boundary between them.
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
