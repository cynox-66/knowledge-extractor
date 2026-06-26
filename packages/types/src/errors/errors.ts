/**
 * Defines standardized error codes across the entire platform.
 */
export enum ErrorCode {
  UNAUTHORIZED = 'UNAUTHORIZED',
  RATE_LIMITED = 'RATE_LIMITED',
  NETWORK_ERROR = 'NETWORK_ERROR',
  PARSE_ERROR = 'PARSE_ERROR',
  UNSUPPORTED_SOURCE = 'UNSUPPORTED_SOURCE',
  VALIDATION_FAILED = 'VALIDATION_FAILED',
}

/**
 * A strongly typed error class ensuring uniform error handling
 * regardless of the connector or engine throwing it.
 */
export class PlatformError extends Error {
  public readonly code: ErrorCode;
  public readonly isRetryable: boolean;

  constructor(message: string, code: ErrorCode, isRetryable: boolean = false) {
    super(message);
    this.name = 'PlatformError';
    this.code = code;
    this.isRetryable = isRetryable;
    Object.setPrototypeOf(this, PlatformError.prototype);
  }
}
