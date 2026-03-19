import { getUserPositionCapId, type AlphalendClient } from '@alphafi/alphalend-sdk';
import type { SuiClient } from '@mysten/sui/client';
import type { FinishContext } from '../../../core/action-builder.js';
import type {
  ActionIntent,
  BorrowIntent,
  RepayIntent,
  SupplyIntent,
  WithdrawIntent,
} from '../../../core/action-types.js';
import type { LendingLog, LendingRecord } from '../../../db/lending-log.js';
import { coinTypeToSymbol } from '../tokens.js';
import { parseAmountFromContext } from './events.js';

interface BuildContext {
  markets: Awaited<ReturnType<AlphalendClient['getMarketsChain']>>;
  portfolio: NonNullable<Awaited<ReturnType<AlphalendClient['getUserPortfolioFromPositionCapId']>>>;
  priceUpdateCoinTypes: Set<string>;
  positionCapId: string;
}

/** Intent types that carry coinType, amount, and marketId params */
type TokenLendingIntent = SupplyIntent | BorrowIntent | WithdrawIntent | RepayIntent;

export class AlphaLendBase {
  constructor(
    protected readonly alphalendClient: AlphalendClient,
    protected readonly suiClient: SuiClient,
  ) {}

  async getBuildContext(
    network: string,
    address: string,
    coinType?: string,
  ): Promise<BuildContext> {
    // Fetch markets and position cap in parallel (independent calls)
    const [markets, positionCapId] = await Promise.all([
      this.alphalendClient.getMarketsChain(),
      getUserPositionCapId(this.suiClient, network, address),
    ]);
    if (markets === undefined || markets.length === 0) {
      throw new Error('No markets found.');
    }
    if (positionCapId === undefined) {
      throw new Error('No position found. Supply collateral first.');
    }
    const marketMap = new Map(markets.map((m) => [+m.market.id, m]));
    const portfolio = await this.alphalendClient.getUserPortfolioFromPositionCapId(positionCapId);
    if (portfolio === undefined) {
      throw new Error('No position found. Supply collateral first.');
    }

    const priceUpdateCoinTypes = new Set<string>(
      coinType !== undefined && coinType !== '' ? [coinType] : [],
    );
    portfolio.borrowedAmounts.forEach((_v, k) => {
      const market = marketMap.get(k);
      if (market !== undefined) {
        priceUpdateCoinTypes.add(market.market.coinType);
      }
    });
    portfolio.suppliedAmounts.forEach((_v, k) => {
      const market = marketMap.get(k);
      if (market !== undefined) {
        priceUpdateCoinTypes.add(market.market.coinType);
      }
    });

    return {
      markets,
      portfolio,
      priceUpdateCoinTypes,
      positionCapId,
    };
  }
}

/**
 * Build a LendingRecord from a FinishContext and log it.
 *
 * Centralizes the finish() logic shared across all lending builders:
 * parse actual amount from events, resolve token symbol, build record
 * with optional fields, and log to LendingLog.
 */
export function finishLendingActivity(
  context: FinishContext,
  action: LendingRecord['action'],
  lendingLog: LendingLog,
): void {
  const intent = context.intent;
  if (intent.action !== action) return;

  const base: LendingRecord = {
    chain_id: intent.chainId,
    wallet_address: intent.walletAddress,
    action,
    protocol: 'alphalend',
    policy_decision: context.status,
    ...(context.txDigest !== undefined ? { tx_digest: context.txDigest } : {}),
    ...(context.gasUsed !== undefined ? { gas_cost: context.gasUsed } : {}),
    ...(context.rejection?.reason !== undefined
      ? { rejection_reason: context.rejection.reason }
      : {}),
    ...(context.rejection?.check !== undefined ? { rejection_check: context.rejection.check } : {}),
  };

  // claim_rewards has no token/amount params
  if (!isTokenLendingIntent(intent)) {
    lendingLog.logActivity(base);
    return;
  }

  const actualAmount = parseAmountFromContext(context, action) ?? intent.params.amount;
  const tokenSymbol = coinTypeToSymbol(intent.params.coinType);

  lendingLog.logActivity({
    ...base,
    market_id: intent.params.marketId,
    coin_type: intent.params.coinType,
    amount: actualAmount,
    ...(tokenSymbol !== undefined ? { token_symbol: tokenSymbol } : {}),
    ...(intent.valueUsd !== undefined ? { value_usd: intent.valueUsd } : {}),
  });
}

function isTokenLendingIntent(intent: ActionIntent): intent is TokenLendingIntent {
  return (
    intent.action === 'supply' ||
    intent.action === 'borrow' ||
    intent.action === 'withdraw' ||
    intent.action === 'repay'
  );
}
