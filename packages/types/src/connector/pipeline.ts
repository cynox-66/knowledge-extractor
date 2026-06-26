import { IResource } from '../core/resource.js';

/**
 * Stage 1: Discovery.
 * Represents a resource that is known to exist but whose full content has not been extracted.
 */
export interface IDiscoveredResource {
  targetUri: string;
  providerName: string;
}

/**
 * Stage 2: Extraction.
 * Represents the raw data pulled from a source by a DOM Adapter or API client.
 * This is an intermediate representation before domain normalization.
 */
export interface IRawSourceResource {
  providerName: string;
  sourceUri: string;
  externalId?: string;
  authorHandle?: string;
  textContent?: string;
  mediaUris: string[];
  publishedAt?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Stage 3: Normalization.
 * The standard interface every provider-specific connector must implement to
 * map raw extracted data into the strict Domain Model.
 */
export interface IConnector {
  readonly providerName: string;
  normalize(raw: IRawSourceResource): Promise<IResource>;
}
