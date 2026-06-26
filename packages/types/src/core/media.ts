/**
 * Defines the standardized classification for binary assets.
 */
export enum MediaType {
  IMAGE = 'image',
  VIDEO = 'video',
  AUDIO = 'audio',
  DOCUMENT = 'document',
  UNKNOWN = 'unknown',
}

/**
 * Represents a binary asset inextricably linked to a Resource.
 * Media cannot exist independently of a parent Resource.
 */
export interface IMedia {
  /**
   * The globally unique identifier for this media asset within the system.
   */
  id: string;
  /**
   * The standardized classification of the media.
   */
  type: MediaType;
  /**
   * The original URI where the media was hosted by the provider.
   */
  sourceUri: string;
  /**
   * The localized URI or path where the binary data is cached within the platform.
   * This is undefined until the media has been fully hydrated.
   */
  localUri?: string;
  /**
   * The MIME type of the binary asset.
   */
  mimeType?: string;
  /**
   * The size of the binary asset in bytes.
   */
  sizeBytes?: number;
}
