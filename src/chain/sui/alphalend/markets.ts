import type { AlphalendClient } from '@alphafi/alphalend-sdk';
import { normalizeStructTag } from '@mysten/sui/utils';

// ---------------------------------------------------------------------------
// Local type definitions mirroring the SDK's runtime shapes.
// We define them here so we get strict-typed property access without depending
// on SDK type exports that may or may not be re-exported.
// ---------------------------------------------------------------------------

/** Decimal.js-compatible value returned by the SDK. */
interface DecimalLike {
  toNumber(): number;
}

/** A single reward entry returned inside `supplyApr.rewards` / `borrowApr.rewards`. */
interface SdkRewardEntry {
  readonly coinType: string;
  readonly rewardApr: string;
}

/** Shape of a single market returned by `getAllMarkets()`. */
interface SdkMarketData {
  readonly marketId: string;
  readonly coinType: string;
  readonly price: DecimalLike;
  readonly supplyApr: {
    readonly interestApr: DecimalLike;
    readonly stakingApr: DecimalLike;
    readonly rewards: readonly SdkRewardEntry[];
  };
  readonly borrowApr: {
    readonly interestApr: DecimalLike;
    readonly rewards: readonly SdkRewardEntry[];
  };
  readonly ltv: DecimalLike;
  readonly totalSupply: DecimalLike;
  readonly totalBorrow: DecimalLike;
  readonly availableLiquidity: DecimalLike;
  readonly utilizationRate: DecimalLike;
  readonly liquidationThreshold: DecimalLike;
  readonly borrowWeight: DecimalLike;
  readonly allowedDepositAmount: DecimalLike;
  readonly allowedBorrowAmount: DecimalLike;
}

/** Shape of a market returned by `getMarketsChain()`. */
interface SdkChainMarket {
  readonly marketId: string | number;
  readonly symbol?: string;
}

/** Shape of a single portfolio returned by `getUserPortfolio()`. */
interface SdkUserPortfolio {
  readonly netWorth: DecimalLike;
  readonly totalSuppliedUsd: DecimalLike;
  readonly totalBorrowedUsd: DecimalLike;
  readonly rewardsToClaimUsd: DecimalLike;
  readonly netApr: DecimalLike;
  readonly dailyEarnings: DecimalLike;
  readonly borrowLimitUsed: DecimalLike;
  readonly liquidationThreshold: DecimalLike;
}

// ---------------------------------------------------------------------------
// Public DTO interfaces
// ---------------------------------------------------------------------------

export interface AlphaLendMarketInfo {
  readonly marketId: string;
  readonly coinType: string;
  readonly symbol: string;
  readonly supplyApr: number;
  readonly borrowApr: number;
  readonly ltv: number;
  readonly totalSupply: number;
  readonly totalBorrow: number;
  readonly availableLiquidity: number;
  readonly utilizationRate: number;
  readonly active: boolean;
}

export interface AlphaLendMarketDetail extends AlphaLendMarketInfo {
  readonly supplyInterestApr: number;
  readonly supplyStakingApr: number;
  readonly supplyRewardsApr: number;
  readonly borrowInterestApr: number;
  readonly borrowRewardsApr: number;
  readonly liquidationThreshold: number;
  readonly borrowWeight: number;
  readonly allowedDepositAmount: number;
  readonly allowedBorrowAmount: number;
}

export interface AlphaLendPortfolioInfo {
  readonly netWorth: number;
  readonly totalSuppliedUsd: number;
  readonly totalBorrowedUsd: number;
  readonly rewardsToClaimUsd: number;
  readonly netApr: number;
  readonly dailyEarnings: number;
  readonly borrowLimitUsed: number;
  readonly liquidationThreshold: number;
}

// ---------------------------------------------------------------------------
// Market resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a market ID for a given coin type. If `explicitMarketId` is provided
 * it is returned directly without querying the SDK.  Otherwise, all markets are
 * fetched and filtered by `coinType` (using normalised struct tags for a
 * reliable comparison).
 *
 * Throws when zero or more-than-one markets match so the caller can surface a
 * clear error to the user.
 */
export async function resolveMarketId(
  client: AlphalendClient,
  coinType: string,
  explicitMarketId?: string,
): Promise<string> {
  if (explicitMarketId !== undefined) return explicitMarketId;

  const markets = await client.getAllMarkets();

  if (markets === undefined) {
    throw new Error('Failed to fetch AlphaLend markets — SDK returned undefined');
  }

  const normalizedCoinType = normalizeStructTag(coinType);
  const typedMarkets = markets as unknown as SdkMarketData[];
  const matches = typedMarkets.filter((m) => normalizeStructTag(m.coinType) === normalizedCoinType);

  if (matches.length === 0) {
    throw new Error(`No market found for coin type "${coinType}" on AlphaLend`);
  }

  if (matches.length > 1) {
    const ids = matches.map((m) => m.marketId).join(', ');
    throw new Error(
      `Multiple markets found for "${coinType}": [${ids}]. Use --market <id> to specify.`,
    );
  }

  const match = matches[0];
  if (match === undefined) throw new Error('Unexpected empty match array');
  return match.marketId;
}

/** Sum all reward APRs in a rewards array, returning 0 when the array is empty. */
function sumRewardAprs(rewards: readonly SdkRewardEntry[]): number {
  return rewards.reduce((sum, r) => sum + Number(r.rewardApr), 0);
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

/**
 * Fetch all AlphaLend markets and return a normalised DTO array suitable for
 * CLI display.
 */
export async function fetchAllMarkets(client: AlphalendClient): Promise<AlphaLendMarketInfo[]> {
  const [rawMarkets, rawChain] = await Promise.all([
    client.getAllMarkets(),
    client.getMarketsChain(),
  ]);

  if (rawMarkets === undefined) {
    throw new Error('Failed to fetch AlphaLend markets — SDK returned undefined');
  }

  const markets = rawMarkets as unknown as SdkMarketData[];

  // Build a config lookup from on-chain market data keyed by marketId
  const chainMap = new Map<string, { active: boolean; symbol: string }>();
  if (rawChain !== undefined) {
    const chain = rawChain as unknown as SdkChainMarket[];
    for (const c of chain) {
      chainMap.set(`${c.marketId}`, {
        active: true,
        symbol: c.symbol ?? '',
      });
    }
  }

  return markets.map((m): AlphaLendMarketInfo => {
    const chainInfo = chainMap.get(m.marketId);

    return {
      marketId: m.marketId,
      coinType: m.coinType,
      symbol: chainInfo?.symbol ?? '',
      supplyApr: m.supplyApr.interestApr.toNumber(),
      borrowApr: m.borrowApr.interestApr.toNumber(),
      ltv: m.ltv.toNumber(),
      totalSupply: m.totalSupply.toNumber(),
      totalBorrow: m.totalBorrow.toNumber(),
      availableLiquidity: m.availableLiquidity.toNumber(),
      utilizationRate: m.utilizationRate.toNumber(),
      active: chainInfo?.active ?? true,
    };
  });
}

/**
 * Fetch detailed information for a single market identified by `coinType`.
 */
export async function fetchMarketDetail(
  client: AlphalendClient,
  coinType: string,
): Promise<AlphaLendMarketDetail> {
  const rawMarkets = await client.getAllMarkets();

  if (rawMarkets === undefined) {
    throw new Error('Failed to fetch AlphaLend markets — SDK returned undefined');
  }

  const markets = rawMarkets as unknown as SdkMarketData[];
  const normalizedCoinType = normalizeStructTag(coinType);
  const m = markets.find((market) => normalizeStructTag(market.coinType) === normalizedCoinType);

  if (m === undefined) {
    throw new Error(`No market found for "${coinType}"`);
  }

  return {
    marketId: m.marketId,
    coinType: m.coinType,
    symbol: '',
    supplyApr: m.supplyApr.interestApr.toNumber(),
    borrowApr: m.borrowApr.interestApr.toNumber(),
    ltv: m.ltv.toNumber(),
    totalSupply: m.totalSupply.toNumber(),
    totalBorrow: m.totalBorrow.toNumber(),
    availableLiquidity: m.availableLiquidity.toNumber(),
    utilizationRate: m.utilizationRate.toNumber(),
    active: true,
    supplyInterestApr: m.supplyApr.interestApr.toNumber(),
    supplyStakingApr: m.supplyApr.stakingApr.toNumber(),
    supplyRewardsApr: sumRewardAprs(m.supplyApr.rewards),
    borrowInterestApr: m.borrowApr.interestApr.toNumber(),
    borrowRewardsApr: sumRewardAprs(m.borrowApr.rewards),
    liquidationThreshold: m.liquidationThreshold.toNumber(),
    borrowWeight: m.borrowWeight.toNumber(),
    allowedDepositAmount: m.allowedDepositAmount.toNumber(),
    allowedBorrowAmount: m.allowedBorrowAmount.toNumber(),
  };
}

/**
 * Fetch the user's lending portfolio summary.  The SDK returns an array —
 * we take the first element.
 */
export async function fetchPortfolio(
  client: AlphalendClient,
  address: string,
): Promise<AlphaLendPortfolioInfo> {
  const rawPortfolios = await client.getUserPortfolio(address);

  if (rawPortfolios === undefined || rawPortfolios.length === 0) {
    throw new Error(`No portfolio found for address "${address}" on AlphaLend`);
  }

  const portfolio = rawPortfolios[0] as unknown as SdkUserPortfolio;

  return {
    netWorth: portfolio.netWorth.toNumber(),
    totalSuppliedUsd: portfolio.totalSuppliedUsd.toNumber(),
    totalBorrowedUsd: portfolio.totalBorrowedUsd.toNumber(),
    rewardsToClaimUsd: portfolio.rewardsToClaimUsd.toNumber(),
    netApr: portfolio.netApr.toNumber(),
    dailyEarnings: portfolio.dailyEarnings.toNumber(),
    borrowLimitUsed: portfolio.borrowLimitUsed.toNumber(),
    liquidationThreshold: portfolio.liquidationThreshold.toNumber(),
  };
}
