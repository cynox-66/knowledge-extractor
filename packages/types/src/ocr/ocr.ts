import { IMedia } from '../core/media';
import { IContentBlock } from '../core/content';

/**
 * The standard interface for Optical Character Recognition engines.
 */
export interface IOcrEngine {
  /**
   * Processes a localized media asset and extracts text.
   * @param media The localized media asset.
   * @returns A promise resolving to an array of text content blocks.
   */
  extractText(media: IMedia): Promise<IContentBlock[]>;
}
