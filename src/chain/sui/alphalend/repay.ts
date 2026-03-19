import type { AlphalendClient } from '@alphafi/alphalend-sdk';
import { getUserPositionCapId } from '@alphafi/alphalend-sdk';
import type { SuiClient } from '@mysten/sui/client';
import type {
  ActionBuilder,
  BuiltTransaction,
  FinishContext,
} from '../../../core/action-builder.js';
import type { RepayIntent } from '../../../core/action-types.js';
import type { LendingLog } from '../../../db/lending-log.js';
import { coinTypeToSymbol, isSuiCoinType } from '../tokens.js';
import { parseLendingEvent } from './events.js';

/**
 * AlphaLend repay builder for Sui.
 * Implements ActionBuilder for the "repay" action.
 *
 * Fetches the user's position cap ID, applies a 1.001x buffer to the
 * repay amount (to cover accrued interest), then calls the AlphaLend
 * SDK repay method.
 */
export class AlphaLendRepayBuilder implements ActionBuilder<RepayIntent> {
  readonly builderId = 'alphalend-repay';
  readonly chain = 'sui';

  constructor(
    private readonly alphalendClient: AlphalendClient,
    private readonly suiClient: SuiClient,
    private readonly lendingLog: LendingLog,
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
    transaction?.setSenderIfNotSet(intent.walletAddress);

    if (transaction === undefined) {
      throw new Error('Repay failed: coin not found in wallet');
    }

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

  finish(context: FinishContext): void {
    const { intent, status, txDigest, gasUsed, rejection } = context;
    if (intent.action !== 'repay') return;

    const { coinType, amount, marketId } = intent.params;
    const actualAmount = this.parseAmount(context) ?? amount;

    this.lendingLog.logActivity({
      chain_id: intent.chainId,
      wallet_address: intent.walletAddress,
      action: 'repay',
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
    return parseLendingEvent(events as { type: string; parsedJson: unknown }[], 'repay')?.amount;
  }
}
