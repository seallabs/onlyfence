import type { AlphalendClient } from '@alphafi/alphalend-sdk';
import { getUserPositionCapId, MAX_U64 } from '@alphafi/alphalend-sdk';
import type { SuiClient } from '@mysten/sui/client';
import type {
  ActionBuilder,
  BuiltTransaction,
  FinishContext,
} from '../../../core/action-builder.js';
import type { WithdrawIntent } from '../../../core/action-types.js';
import type { LendingLog } from '../../../db/lending-log.js';
import { coinTypeToSymbol } from '../tokens.js';
import { parseLendingEvent } from './events.js';

/**
 * AlphaLend withdraw builder for Sui.
 * Implements ActionBuilder for the "withdraw" action.
 *
 * Fetches the user's position cap ID, then calls the AlphaLend SDK
 * withdraw method. Supports full withdrawal via the `withdrawAll` flag
 * which uses MAX_U64 as the amount.
 */
export class AlphaLendWithdrawBuilder implements ActionBuilder<WithdrawIntent> {
  readonly builderId = 'alphalend-withdraw';
  readonly chain = 'sui';

  constructor(
    private readonly alphalendClient: AlphalendClient,
    private readonly suiClient: SuiClient,
    private readonly lendingLog: LendingLog,
  ) {}

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

    const network = intent.chainId.split(':')[1] ?? 'mainnet';
    const positionCapId = await getUserPositionCapId(this.suiClient, network, intent.walletAddress);
    if (positionCapId === undefined) {
      throw new Error('No position found. Supply collateral first.');
    }

    const withdrawAmount = withdrawAll === true ? MAX_U64 : BigInt(amount);

    const transaction = await this.alphalendClient.withdraw({
      marketId,
      amount: withdrawAmount,
      coinType,
      positionCapId,
      address: intent.walletAddress,
      priceUpdateCoinTypes: [coinType],
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

  finish(context: FinishContext): void {
    const { intent, status, txDigest, gasUsed, rejection } = context;
    if (intent.action !== 'withdraw') return;

    const { coinType, amount, marketId } = intent.params;
    const actualAmount = this.parseAmount(context) ?? amount;

    this.lendingLog.logActivity({
      chain_id: intent.chainId,
      wallet_address: intent.walletAddress,
      action: 'withdraw',
      protocol: 'alphalend',
      market_id: marketId,
      coin_type: coinType,
      token_symbol: coinTypeToSymbol(coinType) ?? coinType,
      amount: actualAmount,
      policy_decision: status,
      ...(txDigest !== undefined ? { tx_digest: txDigest } : {}),
      ...(gasUsed !== undefined ? { gas_cost: gasUsed } : {}),
      ...(rejection?.reason !== undefined ? { rejection_reason: rejection.reason } : {}),
      ...(rejection?.check !== undefined ? { rejection_check: rejection.check } : {}),
      ...(intent.valueUsd !== undefined ? { value_usd: intent.valueUsd } : {}),
    });
  }

  private parseAmount(context: FinishContext): string | undefined {
    if (context.rawResponse === undefined) return undefined;
    const raw = context.rawResponse as Record<string, unknown>;
    const events = raw['events'];
    if (!Array.isArray(events)) return undefined;
    return parseLendingEvent(events as { type: string; parsedJson: unknown }[], 'withdraw')?.amount;
  }
}
