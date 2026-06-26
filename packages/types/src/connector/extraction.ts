import { IResource } from '../core/resource.js';

/**
 * Standardizes the output yielded by a connector's extraction pipeline.
 */
export interface IExtractionResult {
  /**
   * Indicates if the extraction was successful.
   */
  success: boolean;
  /**
   * The normalized resource, if extraction was successful.
   */
  resource?: IResource;
  /**
   * The error message, if the extraction failed.
   */
  error?: string;
  /**
   * A pagination cursor to resume extraction in subsequent batches.
   */
  nextCursor?: string;
}
