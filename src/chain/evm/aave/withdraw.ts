import type { EthereumTransactionTypeExtended } from '@aave/contract-helpers';
import type { WithdrawIntent } from '../../../core/action-types.js';
import { AaveLendBuilderBase, toAaveHumanAmount } from './base.js';

/**
 * Aave V3 withdraw builder.
 *
 * `withdrawAll = true` on the intent maps to the SDK's `-1` sentinel
 * (`type(uint256).max`) which withdraws principal plus accrued interest.
 */
export class AaveLendWithdrawBuilder extends AaveLendBuilderBase<WithdrawIntent> {
  readonly builderId = 'aave-v3-withdraw';
  protected readonly activityAction = 'lending:withdraw' as const;
  protected readonly aaveAction = 'withdraw';

  protected override validateAmount(intent: WithdrawIntent): void {
    if (intent.params.withdrawAll !== true && intent.params.amount === '') {
      throw new Error('Missing withdraw amount');
    }
  }

  protected override resolveAmount(intent: WithdrawIntent): string {
    return intent.params.withdrawAll === true
      ? '-1'
      : toAaveHumanAmount(intent.params.coinType, intent.params.amount);
  }

  protected callPool(
    intent: WithdrawIntent,
    user: string,
    humanAmount: string,
  ): Promise<EthereumTransactionTypeExtended[]> {
    return this.pool.withdraw({
      user,
      reserve: intent.params.coinType,
      amount: humanAmount,
      onBehalfOf: user,
    });
  }
}
