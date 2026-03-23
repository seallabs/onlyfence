import type { AlphalendClient } from '@alphafi/alphalend-sdk';
import { MAX_U64 } from '@alphafi/alphalend-sdk';
import type { SuiClient } from '@mysten/sui/client';
import type {
  ActionBuilder,
  BuiltTransaction,
  FinishContext,
} from '../../../core/action-builder.js';
import type { WithdrawIntent } from '../../../core/action-types.js';
import type { ActivityLog } from '../../../db/activity-log.js';
import type { SuiRawResponse } from '../types.js';
import { AlphaLendBase, finishLendingActivity } from './base.js';

/**
 * AlphaLend withdraw builder for Sui.
 * Implements ActionBuilder for the "withdraw" action.
 *
 * Fetches the user's position cap ID, then calls the AlphaLend SDK
 * withdraw method. Supports full withdrawal via the `withdrawAll` flag
 * which uses MAX_U64 as the amount.
 */
export class AlphaLendWithdrawBuilder
  extends AlphaLendBase
  implements ActionBuilder<WithdrawIntent, SuiRawResponse>
{
  readonly builderId = 'alphalend-withdraw';
  readonly chain = 'sui';

  constructor(
    alphalendClient: AlphalendClient,
    suiClient: SuiClient,
    private readonly activityLog: ActivityLog,
  ) {
    super(alphalendClient, suiClient);
  }

  validate(intent: WithdrawIntent): void {
    const { coinType, amount, marketId, withdrawAll } = intent.params;
    if (coinType === '') {
      throw new Error('Missing coinType');
    }
    if (marketId === '') {
      throw new Error('Missing marketId');
    }
    if (withdrawAll !== true && (amount === '' || BigInt(amount) <= 0n)) {
      throw new Error('Invalid amount: must be positive or use withdrawAll');
    }
  }

  async build(intent: WithdrawIntent): Promise<BuiltTransaction> {
    const { coinType, amount, marketId, withdrawAll } = intent.params;

    const { priceUpdateCoinTypes, positionCapId } = await this.getBuildContext(
      intent.chainId.split(':')[1] ?? 'mainnet',
      intent.walletAddress,
      coinType,
    );

    const withdrawAmount = withdrawAll === true ? MAX_U64 : BigInt(amount);

    const transaction = await this.alphalendClient.withdraw({
      marketId,
      amount: withdrawAmount,
      coinType,
      positionCapId,
      address: intent.walletAddress,
      priceUpdateCoinTypes: Array.from(priceUpdateCoinTypes),
    });
    transaction.setSenderIfNotSet(intent.walletAddress);

    return {
      transaction,
      metadata: {
        action: 'withdraw',
        protocol: 'alphalend',
        marketId,
        coinType,
        amount: amount,
        withdrawAll: withdrawAll ?? false,
      },
    };
  }

  finish(context: FinishContext<SuiRawResponse>): void {
    finishLendingActivity(context, 'lending:withdraw', this.activityLog);
  }
}
