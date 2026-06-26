/**
 * Describes the applicability and confidence of an extraction strategy result.
 */
export interface IStrategyResult<T> {
  /** Whether this strategy was able to handle the input. */
  applicable: boolean;
  /**
   * Confidence score from 0.0 to 1.0 indicating reliability of the extracted data.
   * Only meaningful when `applicable` is true.
   */
  confidence: number;
  /** The extracted data if applicable. */
  data?: T;
  /** Human-readable explanation if the strategy was not applicable. */
  failureReason?: string;
}

/**
 * A single, independently executable extraction strategy.
 * Strategies are tried in ordered chains; the first applicable result wins.
 */
export interface IExtractionStrategy<TInput, TOutput> {
  /** Unique name for observability and debugging. */
  readonly strategyName: string;
  /**
   * Attempt to extract TOutput from the given input.
   * Must never throw; failures are expressed via `IStrategyResult`.
   */
  execute(input: TInput): IStrategyResult<TOutput>;
}
