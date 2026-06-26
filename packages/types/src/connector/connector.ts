import { IExtractionResult } from './extraction';

/**
 * Defines the capabilities of a specific connector implementation.
 */
export interface ConnectorConfig {
  /**
   * The unique identifier for this connector (e.g., 'instagram', 'pdf').
   */
  id: string;
  /**
   * Does this connector require an active user session/authentication?
   */
  requiresAuth: boolean;
  /**
   * Can this connector extract data sequentially using cursors?
   */
  supportsPagination: boolean;
}

/**
 * The standard interface every provider-specific connector must implement.
 */
export interface IConnector {
  /**
   * The static configuration and capabilities of this connector.
   */
  readonly config: ConnectorConfig;

  /**
   * Initiates the extraction process for a given external target.
   * @param targetUri The URL or specific target identifier to extract.
   * @returns An asynchronous stream of extracted resources.
   */
  extract(targetUri: string): AsyncGenerator<IExtractionResult, void, unknown>;

  /**
   * Validates if this connector is capable of handling the given URI.
   * @param uri The target URI.
   */
  canHandle(uri: string): boolean;
}
