import type { AlphalendClient } from '@alphafi/alphalend-sdk';
import type {
  ActionBuilder,
  BuiltTransaction,
  FinishContext,
} from '../../../core/action-builder.js';
import type { SupplyIntent } from '../../../core/action-types.js';
import type { LendingLog } from '../../../db/lending-log.js';
import { coinTypeToSymbol } from '../tokens.js';
import { parseLendingEvent } from './events.js';

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
      coinType: intent.params.coinType,
      address: intent.walletAddress,
    });
    tx?.setSenderIfNotSet(intent.walletAddress);

    if (tx === undefined) {
      throw new Error('AlphaLend supply returned undefined — coin not found on-chain');
    }

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
    const intent = context.intent as SupplyIntent;
    const actualAmount = this.parseAmount(context) ?? intent.params.amount;

    const tokenSymbol = coinTypeToSymbol(intent.params.coinType);

    this.lendingLog.logActivity({
      chain_id: intent.chainId,
      wallet_address: intent.walletAddress,
      action: 'supply',
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
    return parseLendingEvent(events as { type: string; parsedJson: unknown }[], 'supply')?.amount;
  }
}
