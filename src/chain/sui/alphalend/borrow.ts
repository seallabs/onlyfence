import type { AlphalendClient } from '@alphafi/alphalend-sdk';
import { getUserPositionCapId } from '@alphafi/alphalend-sdk';
import type { SuiClient } from '@mysten/sui/client';
import type {
  ActionBuilder,
  BuiltTransaction,
  FinishContext,
} from '../../../core/action-builder.js';
import type { BorrowIntent } from '../../../core/action-types.js';
import type { LendingLog } from '../../../db/lending-log.js';
import { coinTypeToSymbol } from '../tokens.js';
import { parseLendingEvent } from './events.js';

/**
 * AlphaLend borrow builder for Sui.
 *
 * Implements ActionBuilder for the "borrow" lending action.
 * Fetches the user's position cap ID, then delegates to the AlphaLend SDK
 * to build the borrow transaction. Logs the activity to LendingLog.
 */
export class AlphaLendBorrowBuilder implements ActionBuilder<BorrowIntent> {
  readonly builderId = 'alphalend-borrow';
  readonly chain = 'sui';

  constructor(
    private readonly alphalendClient: AlphalendClient,
    private readonly suiClient: SuiClient,
    private readonly lendingLog: LendingLog,
  ) {}

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
    const network = intent.chainId.split(':')[1] ?? 'mainnet';

    const positionCapId = await getUserPositionCapId(this.suiClient, network, intent.walletAddress);

    if (positionCapId === undefined) {
      throw new Error('No position found. Supply collateral first.');
    }

    const tx = await this.alphalendClient.borrow({
      marketId: intent.params.marketId,
      amount: BigInt(intent.params.amount),
      coinType: intent.params.coinType,
      positionCapId,
      address: intent.walletAddress,
      priceUpdateCoinTypes: [intent.params.coinType],
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

  finish(context: FinishContext): void {
    const intent = context.intent as BorrowIntent;
    const actualAmount = this.parseAmount(context) ?? intent.params.amount;

    const tokenSymbol = coinTypeToSymbol(intent.params.coinType);

    this.lendingLog.logActivity({
      chain_id: intent.chainId,
      wallet_address: intent.walletAddress,
      action: 'borrow',
      protocol: 'alphalend',
      market_id: intent.params.marketId,
      coin_type: intent.params.coinType,
      amount: actualAmount,
      policy_decision: context.status,
      ...(tokenSymbol !== undefined ? { token_symbol: tokenSymbol } : {}),
      ...(context.txDigest !== undefined ? { tx_digest: context.txDigest } : {}),
      ...(context.gasUsed !== undefined ? { gas_cost: context.gasUsed } : {}),
      ...(context.rejection?.reason !== undefined
        ? { rejection_reason: context.rejection.reason }
        : {}),
      ...(context.rejection?.check !== undefined
        ? { rejection_check: context.rejection.check }
        : {}),
      ...(intent.valueUsd !== undefined ? { value_usd: intent.valueUsd } : {}),
    });
  }

  private parseAmount(context: FinishContext): string | undefined {
    if (context.rawResponse === undefined) return undefined;
    const raw = context.rawResponse as Record<string, unknown>;
    const events = raw['events'];
    if (!Array.isArray(events)) return undefined;
    return parseLendingEvent(events as { type: string; parsedJson: unknown }[], 'borrow')?.amount;
  }
}
