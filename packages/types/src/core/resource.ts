import { ISource } from './source.js';
import { IAuthor } from './author.js';
import { IMedia } from './media.js';
import { IContentBlock } from './content.js';

/**
 * Defines the fundamental lifecycle states of a Resource.
 */
export enum ResourceState {
  DISCOVERED = 'discovered',
  EXTRACTED = 'extracted',
  HYDRATED = 'hydrated',
  ENRICHED = 'enriched',
  PERSISTED = 'persisted',
  EXPORTED = 'exported',
}

/**
 * Tracks which parts of a resource have been successfully extracted.
 */
export interface IResourceCompleteness {
  thumbnail: boolean;
  metadata: boolean;
  media: boolean;
  ocr: boolean;
}

/**
 * The fundamental Aggregate Root of the Knowledge Extractor domain.
 * A Resource represents a normalized, autonomous unit of knowledge
 * translated from an external provider.
 */
export interface IResource {
  /**
   * The globally unique identifier for this resource within the platform.
   * This is typically derived deterministically from the Source to guarantee idempotency.
   */
  id: string;
  /**
   * The classification of the resource (e.g., 'document', 'profile', 'collection').
   */
  kind: string;
  /**
   * The current lifecycle state of the resource.
   */
  state: ResourceState;
  /**
   * The strict provenance of the resource.
   */
  source: ISource;
  /**
   * The originator of the resource, if applicable.
   */
  author?: IAuthor;
  /**
   * The semantic structural body of the resource.
   */
  content: IContentBlock[];
  /**
   * The binary assets inextricably linked to and owned by this resource.
   */
  media: IMedia[];
  /**
   * Hierarchical composition: A Resource may contain child resources
   * (e.g., a Thread containing multiple nested reply Resources).
   */
  children?: IResource[];
  /**
   * Indicates the extraction completeness of this resource.
   */
  completeness: IResourceCompleteness;
}
