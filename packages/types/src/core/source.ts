/**
 * Represents the provenance and original location of extracted knowledge.
 * Every resource in the system must be traceable back to a source.
 */
export interface ISource {
  /**
   * The name of the platform or system that originated the data.
   * @example "instagram", "reddit", "local-filesystem"
   */
  providerName: string;
  /**
   * The unique identifier assigned to the content by the provider.
   */
  externalId: string;
  /**
   * The canonical URI where the content was found.
   */
  originalUri?: string;
  /**
   * The ISO 8601 timestamp representing when the extraction occurred.
   */
  extractedAt: string;
  /**
   * Extensible metadata for source-specific tracing requirements.
   * This should not contain business logic fields.
   */
  metadata?: Record<string, unknown>;
}
