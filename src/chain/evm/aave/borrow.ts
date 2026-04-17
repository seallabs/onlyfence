import { InterestRate, type EthereumTransactionTypeExtended } from '@aave/contract-helpers';
import type { BorrowIntent } from '../../../core/action-types.js';
import { AaveLendBuilderBase } from './base.js';

/**
 * Aave V3 borrow builder.
 *
 * Always opens a variable-rate debt position — stable rate is being
 * phased out across Aave V3 deployments and new borrows cannot be
 * opened stable on mainnet.
 */
export class AaveLendBorrowBuilder extends AaveLendBuilderBase<BorrowIntent> {
  readonly builderId = 'aave-v3-borrow';
  protected readonly activityAction = 'lending:borrow' as const;
  protected readonly aaveAction = 'borrow';

  protected callPool(
    intent: BorrowIntent,
    user: string,
    humanAmount: string,
  ): Promise<EthereumTransactionTypeExtended[]> {
    return this.pool.borrow({
      user,
      reserve: intent.params.coinType,
      amount: humanAmount,
      interestRateMode: InterestRate.Variable,
      onBehalfOf: user,
    });
  }
}
