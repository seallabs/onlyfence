import type { AlphalendClient } from '@alphafi/alphalend-sdk';
import { getUserPositionCapId } from '@alphafi/alphalend-sdk';
import type { SuiClient } from '@mysten/sui/client';
import type {
  ActionBuilder,
  BuiltTransaction,
  FinishContext,
} from '../../../core/action-builder.js';
import type { RepayIntent } from '../../../core/action-types.js';
import type { ActivityLog } from '../../../db/activity-log.js';
import { isSuiCoinType } from '../tokens.js';
import type { SuiRawResponse } from '../types.js';
import { finishLendingActivity } from './base.js';

/**
 * AlphaLend repay builder for Sui.
 * Implements ActionBuilder for the "repay" action.
 *
 * Fetches the user's position cap ID, applies a 1.001x buffer to the
 * repay amount (to cover accrued interest), then calls the AlphaLend
 * SDK repay method.
 */
export class AlphaLendRepayBuilder implements ActionBuilder<RepayIntent, SuiRawResponse> {
  readonly builderId = 'alphalend-repay';
  readonly chain = 'sui';

  constructor(
    private readonly alphalendClient: AlphalendClient,
    private readonly suiClient: SuiClient,
    private readonly activityLog: ActivityLog,
  ) {}

  validate(intent: RepayIntent): void {
    const { coinType, amount, marketId } = intent.params;
    if (coinType === '') {
      throw new Error('Missing coinType');
    }
    if (marketId === '') {
      throw new Error('Missing marketId');
    }
    if (amount === '' || BigInt(amount) <= 0n) {
      throw new Error('Invalid amount: must be positive');
    }
  }

  async build(intent: RepayIntent): Promise<BuiltTransaction> {
    const { coinType, amount, marketId } = intent.params;

    const network = intent.chainId.split(':')[1] ?? 'mainnet';
    const positionCapId = await getUserPositionCapId(this.suiClient, network, intent.walletAddress);
    if (positionCapId === undefined) {
      throw new Error('No position found. Supply collateral first.');
    }

    // Apply 1.001x buffer for accrued interest (bigint-safe)
    const rawAmount = BigInt(amount);
    const bufferedAmount = (rawAmount * 1001n) / 1000n;

    const transaction = await this.alphalendClient.repay({
      marketId,
      amount: bufferedAmount,
      coinType: isSuiCoinType(coinType) ? '0x2::sui::SUI' : coinType,
      positionCapId,
      address: intent.walletAddress,
    });
    if (transaction === undefined) {
      throw new Error('Repay failed: coin not found in wallet');
    }
    transaction.setSenderIfNotSet(intent.walletAddress);

    return {
      transaction,
      metadata: {
        action: 'repay',
        protocol: 'alphalend',
        marketId,
        coinType,
        amount,
        bufferedAmount: bufferedAmount.toString(),
      },
    };
  }

  finish(context: FinishContext<SuiRawResponse>): void {
    finishLendingActivity(context, 'lending:repay', this.activityLog);
  }
}
