import type { AlphalendClient } from '@alphafi/alphalend-sdk';
import type { SuiClient } from '@mysten/sui/client';
import type {
  ActionBuilder,
  BuiltTransaction,
  FinishContext,
} from '../../../core/action-builder.js';
import type { BorrowIntent } from '../../../core/action-types.js';
import type { ActivityLog } from '../../../db/activity-log.js';
import type { SuiRawResponse } from '../types.js';
import { AlphaLendBase, finishLendingActivity } from './base.js';

/**
 * AlphaLend borrow builder for Sui.
 *
 * Implements ActionBuilder for the "borrow" lending action.
 * Fetches the user's position cap ID, then delegates to the AlphaLend SDK
 * to build the borrow transaction. Logs the activity to ActivityLog.
 */
export class AlphaLendBorrowBuilder
  extends AlphaLendBase
  implements ActionBuilder<BorrowIntent, SuiRawResponse>
{
  readonly builderId = 'alphalend-borrow';
  readonly chain = 'sui';

  constructor(
    alphalendClient: AlphalendClient,
    suiClient: SuiClient,
    private readonly activityLog: ActivityLog,
  ) {
    super(alphalendClient, suiClient);
  }

  validate(intent: BorrowIntent): void {
    if (intent.params.coinType === '') {
      throw new Error('Missing coinType');
    }
    if (intent.params.amount === '' || BigInt(intent.params.amount) <= 0n) {
      throw new Error('Invalid amount: must be greater than zero');
    }
    if (intent.params.marketId === '') {
      throw new Error('Missing marketId');
    }
  }

  async build(intent: BorrowIntent): Promise<BuiltTransaction> {
    const { priceUpdateCoinTypes, positionCapId } = await this.getBuildContext(
      intent.chainId.split(':')[1] ?? 'mainnet',
      intent.walletAddress,
      intent.params.coinType,
    );

    const tx = await this.alphalendClient.borrow({
      marketId: intent.params.marketId,
      amount: BigInt(intent.params.amount),
      coinType: intent.params.coinType,
      positionCapId,
      address: intent.walletAddress,
      priceUpdateCoinTypes: Array.from(priceUpdateCoinTypes),
    });
    tx.setSenderIfNotSet(intent.walletAddress);

    return {
      transaction: tx,
      metadata: {
        action: 'borrow',
        protocol: 'alphalend',
        marketId: intent.params.marketId,
        coinType: intent.params.coinType,
        amount: intent.params.amount,
      },
    };
  }

  finish(context: FinishContext<SuiRawResponse>): void {
    finishLendingActivity(context, 'lending:borrow', this.activityLog);
  }
}
