import type { AlphalendClient } from '@alphafi/alphalend-sdk';
import type {
  ActionBuilder,
  BuiltTransaction,
  FinishContext,
} from '../../../core/action-builder.js';
import type { SupplyIntent } from '../../../core/action-types.js';
import type { LendingLog } from '../../../db/lending-log.js';
import { isSuiCoinType } from '../tokens.js';
import { finishLendingActivity } from './base.js';

/**
 * AlphaLend supply builder for Sui.
 *
 * Implements ActionBuilder for the "supply" lending action.
 * Delegates to the AlphaLend SDK to build the on-chain transaction
 * and logs the activity to LendingLog after execution.
 */
export class AlphaLendSupplyBuilder implements ActionBuilder<SupplyIntent> {
  readonly builderId = 'alphalend-supply';
  readonly chain = 'sui';

  constructor(
    private readonly alphalendClient: AlphalendClient,
    private readonly lendingLog: LendingLog,
  ) {}

  validate(intent: SupplyIntent): void {
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

  async build(intent: SupplyIntent): Promise<BuiltTransaction> {
    const tx = await this.alphalendClient.supply({
      marketId: intent.params.marketId,
      amount: BigInt(intent.params.amount),
      coinType: isSuiCoinType(intent.params.coinType) ? '0x2::sui::SUI' : intent.params.coinType,
      address: intent.walletAddress,
    });
    if (tx === undefined) {
      throw new Error('AlphaLend supply returned undefined — coin not found on-chain');
    }
    tx.setSenderIfNotSet(intent.walletAddress);
    return {
      transaction: tx,
      metadata: {
        action: 'supply',
        protocol: 'alphalend',
        marketId: intent.params.marketId,
        coinType: intent.params.coinType,
        amount: intent.params.amount,
      },
    };
  }

  finish(context: FinishContext): void {
    finishLendingActivity(context, 'supply', this.lendingLog);
  }
}
