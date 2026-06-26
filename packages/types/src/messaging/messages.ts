/**
 * Standardized message actions used over the Extension RPC bridge.
 */
export enum MessageAction {
  DISCOVER_CONTENT = 'DISCOVER_CONTENT',
  START_EXTRACTION = 'START_EXTRACTION',
  EXTRACTION_PROGRESS = 'EXTRACTION_PROGRESS',
  SYSTEM_STATUS = 'SYSTEM_STATUS',
}

/**
 * The base payload structure for all cross-context messages.
 */
export interface IMessagePayload<T = unknown> {
  /**
   * The action identifier.
   */
  action: MessageAction;
  /**
   * The strongly typed data payload.
   */
  data: T;
  /**
   * An optional correlation ID to match requests with responses.
   */
  correlationId?: string;
}
