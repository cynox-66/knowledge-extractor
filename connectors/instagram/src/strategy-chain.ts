import {
  IExtractionStrategy,
  IStrategyResult,
  ErrorCode,
  PlatformError,
} from '@knowledge-extractor/types';
import { Logger } from '@knowledge-extractor/shared';

/**
 * Executes an ordered list of strategies, returning the result of the first
 * applicable one. If no strategy succeeds, throws a PlatformError.
 */
export class StrategyChain<TInput, TOutput> {
  private readonly logger: Logger;
  private readonly strategies: IExtractionStrategy<TInput, TOutput>[];

  constructor(context: string, strategies: IExtractionStrategy<TInput, TOutput>[]) {
    this.logger = new Logger(`StrategyChain:${context}`);
    this.strategies = strategies;
  }

  execute(input: TInput): TOutput {
    for (const strategy of this.strategies) {
      this.logger.debug(`Trying strategy: ${strategy.strategyName}`);
      let result: IStrategyResult<TOutput>;
      try {
        result = strategy.execute(input);
      } catch (err) {
        this.logger.warn(`Strategy "${strategy.strategyName}" threw unexpectedly`, err);
        continue;
      }

      if (result.applicable && result.data !== undefined) {
        this.logger.info(
          `Strategy "${strategy.strategyName}" succeeded (confidence=${result.confidence.toFixed(2)})`,
        );
        return result.data;
      }

      this.logger.debug(
        `Strategy "${strategy.strategyName}" not applicable: ${result.failureReason ?? 'no reason given'}`,
      );
    }

    throw new PlatformError(
      'All extraction strategies exhausted without a successful result.',
      ErrorCode.PARSE_ERROR,
      false,
    );
  }
}
