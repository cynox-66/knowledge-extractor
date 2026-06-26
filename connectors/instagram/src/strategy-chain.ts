import {
  IExtractionStrategy,
  IStrategyResult,
  ErrorCode,
  PlatformError,
} from '@knowledge-extractor/types';
import { Logger } from '@knowledge-extractor/shared';

/** The successful output of a chain run, tagged with the winning strategy. */
export interface IChainResult<TOutput> {
  data: TOutput;
  /** Name of the strategy that produced the result (for diagnostics). */
  strategyName: string;
}

/**
 * Executes an ordered list of strategies, returning the result of the first
 * applicable one (tagged with its name). If no strategy succeeds, throws a
 * PlatformError.
 */
export class StrategyChain<TInput, TOutput> {
  private readonly logger: Logger;
  private readonly strategies: IExtractionStrategy<TInput, TOutput>[];

  constructor(context: string, strategies: IExtractionStrategy<TInput, TOutput>[]) {
    this.logger = new Logger(`StrategyChain:${context}`);
    this.strategies = strategies;
  }

  execute(input: TInput): IChainResult<TOutput> {
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
        return { data: result.data, strategyName: strategy.strategyName };
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
