import { getUserPositionCapId, type AlphalendClient } from '@alphafi/alphalend-sdk';
import type { SuiClient } from '@mysten/sui/client';
import { normalizeStructTag } from '@mysten/sui/utils';
import BigNumber from 'bignumber.js';
import type { FinishContext } from '../../../core/action-builder.js';
import type {
  ActionIntent,
  ActivityAction,
  BorrowIntent,
  RepayIntent,
  SupplyIntent,
  WithdrawIntent,
} from '../../../core/action-types.js';
import type { ActivityLog, ActivityRecord } from '../../../db/activity-log.js';
import type { SuiRawResponse } from '../types.js';
import { parseAlphaLendEvent, type AlphaLendEvent } from './events.js';

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
 * Build an ActivityRecord from a FinishContext and log it.
 *
 * Centralizes the finish() logic shared across all lending builders:
 * parse actual amount from events, resolve token symbol, build record
 * with optional fields, and log to ActivityLog.
 */
export function finishLendingActivity(
  context: FinishContext<SuiRawResponse>,
  action: ActivityAction,
  activityLog: ActivityLog,
): void {
  const intent = context.intent;
  if (intent.action !== action) return;

  const base: ActivityRecord = {
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
    activityLog.logActivity(base);
    return;
  }

  const event = parseAlphaLendEvent(context.rawResponse?.events ?? [], action);
  const log = toActivityLog(event);
  const usdValue = log?.value_usd ?? intent.valueUsd;

  activityLog.logActivity({
    ...base,
    token_a_type: log?.token_a_type,
    token_a_amount: log?.token_a_amount,
    ...(usdValue !== undefined ? { value_usd: usdValue } : {}),
    metadata: {
      market_id: intent.params.marketId,
      ...(log?.metadata !== undefined && 'rewards' in log.metadata
        ? { rewards: log.metadata['rewards'] }
        : {}),
    },
  });
}

function isTokenLendingIntent(intent: ActionIntent): intent is TokenLendingIntent {
  return (
    intent.action === 'lending:supply' ||
    intent.action === 'lending:borrow' ||
    intent.action === 'lending:withdraw' ||
    intent.action === 'lending:repay'
  );
}

interface ParsedActivityLog {
  readonly token_a_type: string;
  readonly token_a_amount: string;
  readonly value_usd?: number;
  readonly metadata?: Record<string, unknown>;
}

function toActivityLog(event?: AlphaLendEvent): ParsedActivityLog | undefined {
  if (event === undefined) return undefined;
  if (Array.isArray(event)) {
    return {
      token_a_type: '',
      token_a_amount: '0',
      metadata: {
        rewards: event.map((e) => ({
          token_amount: e.reward_amount,
          token_type: e.reward_type.name,
        })),
      },
    };
  }
  switch (event.__type) {
    case 'lending:supply':
      return {
        token_a_type: normalizeStructTag(event.cointype.name),
        token_a_amount: event.deposit_amount,
        value_usd: BigNumber(event.deposit_value).div(100).toNumber(),
        metadata: { market_id: event.market_id },
      };
    case 'lending:withdraw':
      return {
        token_a_type: normalizeStructTag(event.cointype.name),
        token_a_amount: event.withdraw_amount,
        value_usd: BigNumber(event.withdraw_value).div(100).toNumber(),
        metadata: { market_id: event.market_id },
      };
    case 'lending:borrow':
      return {
        token_a_type: normalizeStructTag(event.cointype.name),
        token_a_amount: event.borrow_amount,
        value_usd: BigNumber(event.borrow_value).div(100).toNumber(),
        metadata: { market_id: event.market_id },
      };
    case 'lending:repay':
      return {
        token_a_type: normalizeStructTag(event.cointype.name),
        token_a_amount: event.repay_amount,
        value_usd: BigNumber(event.repay_value).div(100).toNumber(),
        metadata: { market_id: event.market_id },
      };
  }
}
