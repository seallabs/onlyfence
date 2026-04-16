import { InterestRate, type EthereumTransactionTypeExtended } from '@aave/contract-helpers';
import type { RepayIntent } from '../../../core/action-types.js';
import { AaveLendBuilderBase, toAaveHumanAmount } from './base.js';

/**
 * Aave V3 repay builder.
 *
 * Passing `amount = '-1'` on the intent signals "repay full debt"
 * (`type(uint256).max` on the pool call), matching the withdraw-all
 * convention used by `AaveLendWithdrawBuilder`.
 */
export class AaveLendRepayBuilder extends AaveLendBuilderBase<RepayIntent> {
  readonly builderId = 'aave-v3-repay';
  protected readonly activityAction = 'lending:repay' as const;
  protected readonly aaveAction = 'repay';

  protected override resolveAmount(intent: RepayIntent): string {
    return intent.params.amount === '-1'
      ? '-1'
      : toAaveHumanAmount(intent.params.coinType, intent.params.amount);
  }

  protected callPool(
    intent: RepayIntent,
    user: string,
    humanAmount: string,
  ): Promise<EthereumTransactionTypeExtended[]> {
    return this.pool.repay({
      user,
      reserve: intent.params.coinType,
      amount: humanAmount,
      interestRateMode: InterestRate.Variable,
      onBehalfOf: user,
    });
  }
}
