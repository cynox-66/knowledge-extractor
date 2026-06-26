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
