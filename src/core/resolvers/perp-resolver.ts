/**
 * Perp intent resolvers: resolve raw CLI inputs into pipeline-ready perp intents.
 *
 * Handles: market symbol resolution, amount scaling, USDC coin type resolution,
 * market coin type generation, position lookup (for close), and USD price computation.
 *
 * All four perp actions share a single file since they share helpers and the
 * PerpProvider dependency. Each resolver class is intentionally small.
 */

import type {
  ActivityAction,
  PerpCancelOrderIntent,
  PerpDepositIntent,
  PerpPlaceOrderIntent,
  PerpProtocol,
  PerpWithdrawIntent,
} from '../action-types.js';
import type { IntentResolver, ResolvedExecution, ResolverDeps } from '../intent-resolver.js';
import type { PerpProvider } from '../perp-provider.js';
import { fromE9 } from '../../utils/bigint.js';
import { resolveTokenInput } from '../../cli/resolve.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function getProvider(deps: ResolverDeps, protocol: PerpProtocol): PerpProvider {
  const registry = deps.services.perpProviders;
  if (registry === undefined) {
    throw new Error('PerpProviderRegistry not available in resolver services');
  }
  return registry.get(protocol);
}

function resolveUsdcCoinType(deps: ResolverDeps): string {
  return deps.chainAdapter.resolveTokenAddress('USDC');
}

// ---------------------------------------------------------------------------
// Deposit resolver
// ---------------------------------------------------------------------------

export class PerpDepositResolver implements IntentResolver {
  readonly supportedActions: readonly ActivityAction[] = ['perp:deposit'];

  async resolve(rawIntent: PerpDepositIntent, deps: ResolverDeps): Promise<ResolvedExecution> {
    const { chainAdapter, dataProvider, walletAddress } = deps;
    const { protocol } = rawIntent.params;

    // Resolve USDC token input (symbol → coin type, human amount → smallest unit)
    const resolved = await resolveTokenInput(
      'USDC',
      rawIntent.params.amount, // raw human-readable amount from CLI
      chainAdapter,
      dataProvider,
    );

    // Compute USD value (best-effort)
    let tradeValueUsd: number | undefined;
    try {
      const price = await dataProvider.getPrice(resolved.coinType);
      tradeValueUsd = parseFloat(rawIntent.params.amount) * price;
    } catch {
      // Price unavailable — continue without USD value
    }

    const resolvedIntent: PerpDepositIntent = {
      chainId: rawIntent.chainId,
      action: 'perp:deposit',
      walletAddress,
      params: {
        protocol,
        coinType: resolved.coinType,
        amount: resolved.scaledAmount,
        decimals: resolved.decimals,
      },
      ...(tradeValueUsd !== undefined ? { valueUsd: tradeValueUsd } : {}),
    };

    return { intent: resolvedIntent, tradeValueUsd };
  }
}

// ---------------------------------------------------------------------------
// Withdraw resolver
// ---------------------------------------------------------------------------

export class PerpWithdrawResolver implements IntentResolver {
  readonly supportedActions: readonly ActivityAction[] = ['perp:withdraw'];

  resolve(rawIntent: PerpWithdrawIntent, deps: ResolverDeps): Promise<ResolvedExecution> {
    const tradeValueUsd = parseFloat(fromE9(rawIntent.params.amountE9).toString());

    const resolvedIntent: PerpWithdrawIntent = {
      ...rawIntent,
      walletAddress: deps.walletAddress,
      ...(Number.isFinite(tradeValueUsd) ? { valueUsd: tradeValueUsd } : {}),
    };

    return Promise.resolve({
      intent: resolvedIntent,
      tradeValueUsd: Number.isFinite(tradeValueUsd) ? tradeValueUsd : undefined,
    });
  }
}

// ---------------------------------------------------------------------------
// Cancel resolver
// ---------------------------------------------------------------------------

export class PerpCancelResolver implements IntentResolver {
  readonly supportedActions: readonly ActivityAction[] = ['perp:cancel_order'];

  async resolve(rawIntent: PerpCancelOrderIntent, deps: ResolverDeps): Promise<ResolvedExecution> {
    const provider = getProvider(deps, rawIntent.params.protocol);
    const marketSymbol = await provider.resolveMarket(rawIntent.params.marketSymbol);

    const resolvedIntent: PerpCancelOrderIntent = {
      chainId: rawIntent.chainId,
      action: 'perp:cancel_order',
      walletAddress: deps.walletAddress,
      params: {
        ...rawIntent.params,
        marketSymbol,
      },
    };

    return { intent: resolvedIntent };
  }
}

// ---------------------------------------------------------------------------
// Place order resolver
// ---------------------------------------------------------------------------

export class PerpPlaceOrderResolver implements IntentResolver {
  readonly supportedActions: readonly ActivityAction[] = ['perp:place_order'];

  async resolve(rawIntent: PerpPlaceOrderIntent, deps: ResolverDeps): Promise<ResolvedExecution> {
    const provider = getProvider(deps, rawIntent.params.protocol);

    // Parallelize market resolution, ticker price, and markets metadata.
    // resolveMarket calls getMarkets() internally (cached 30s), so the
    // getMarkets() call below is a cache hit — zero extra network cost.
    const [marketSymbol, tickerResult, marketsResult] = await Promise.all([
      provider.resolveMarket(rawIntent.params.marketSymbol),
      provider.getTickerPrice(rawIntent.params.marketSymbol).catch(() => undefined),
      provider.getMarkets().catch(() => undefined),
    ]);

    // Resolve coin types
    const collateralCoinType = resolveUsdcCoinType(deps);
    const marketCoinType = provider.toMarketCoinType(marketSymbol.split('-')[0] ?? marketSymbol);

    // Compute trade value USD from ticker or limit price
    const { limitPriceE9, quantityE9 } = rawIntent.params;
    const price = limitPriceE9 !== undefined ? fromE9(limitPriceE9) : tickerResult;
    const tradeValueUsd = price !== undefined ? price * fromE9(quantityE9) : undefined;

    // Extract max leverage from markets metadata (used by policy checks)
    const marketInfo = marketsResult?.find((m) => m.symbol === marketSymbol);
    const perpMarketMaxLeverage =
      marketInfo !== undefined ? fromE9(marketInfo.maxLeverageE9) : undefined;

    const resolvedIntent: PerpPlaceOrderIntent = {
      chainId: rawIntent.chainId,
      action: 'perp:place_order',
      walletAddress: deps.walletAddress,
      params: {
        ...rawIntent.params,
        marketSymbol,
        collateralCoinType,
        marketCoinType,
      },
      ...(tradeValueUsd !== undefined ? { valueUsd: tradeValueUsd } : {}),
    };

    return {
      intent: resolvedIntent,
      tradeValueUsd,
      ...(tickerResult !== undefined ? { perpMarketPrice: tickerResult } : {}),
      ...(perpMarketMaxLeverage !== undefined ? { perpMarketMaxLeverage } : {}),
    };
  }
}
