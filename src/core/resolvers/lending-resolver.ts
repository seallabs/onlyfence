/**
 * LendingIntentResolver: resolves raw lending inputs into canonical values.
 *
 * Handles: token symbol → coin type, human amount → smallest unit,
 * market ID resolution, and USD price computation.
 *
 * Chain-agnostic: protocol-specific dependencies (market resolver) are
 * injected via the services map, not imported directly.
 *
 * Supports: lending:supply, lending:borrow, lending:withdraw, lending:repay.
 */

import { resolveTokenInput, resolveTokenOnly } from '../../cli/resolve.js';
import type {
  ActionIntent,
  ActivityAction,
  BorrowIntent,
  LendingAction,
  RepayIntent,
  SupplyIntent,
  TokenLendingIntent,
  WithdrawIntent,
} from '../action-types.js';
import type { IntentResolver, ResolvedExecution, ResolverDeps } from '../intent-resolver.js';

export class LendingIntentResolver implements IntentResolver {
  readonly supportedActions: readonly ActivityAction[] = [
    'lending:supply',
    'lending:borrow',
    'lending:withdraw',
    'lending:repay',
  ];

  async resolve(rawIntent: ActionIntent, deps: ResolverDeps): Promise<ResolvedExecution> {
    const intent = rawIntent as TokenLendingIntent;
    const { chainAdapter, dataProvider, walletAddress, services } = deps;
    const rawParams = intent.params;

    const chain = rawIntent.chainId.split(':')[0] ?? rawIntent.chainId;
    const resolveMarket = services.marketResolvers.get(chain);
    if (resolveMarket === undefined) {
      throw new Error(`LendingIntentResolver: no marketResolver registered for chain "${chain}"`);
    }

    // When withdrawAll is set the builder uses MAX_WITHDRAW and ignores the amount,
    // so skip amount scaling to avoid a false "must be a positive number" error.
    const withdrawAll =
      rawIntent.action === 'lending:withdraw' &&
      (rawParams as WithdrawIntent['params']).withdrawAll === true;
    const resolved = withdrawAll
      ? await resolveTokenOnly(rawParams.coinType, chainAdapter, dataProvider)
      : await resolveTokenInput(rawParams.coinType, rawParams.amount, chainAdapter, dataProvider);

    // Resolve market ID and price in parallel (independent operations)
    const [marketId, tradeValueUsd] = await Promise.all([
      resolveMarket(resolved.coinType, rawParams.marketId !== '' ? rawParams.marketId : undefined),
      dataProvider
        .getPrice(resolved.coinType)
        .then((price) => parseFloat(rawParams.amount) * price),
    ]);

    // Build resolved intent matching the action type
    const resolvedIntent = buildResolvedIntent(
      intent.action,
      rawIntent.chainId,
      walletAddress,
      resolved.coinType,
      resolved.scaledAmount,
      marketId,
      rawParams.protocol,
      tradeValueUsd,
      intent.action === 'lending:withdraw'
        ? (rawParams as WithdrawIntent['params']).withdrawAll
        : undefined,
    );

    return { intent: resolvedIntent, tradeValueUsd };
  }
}

/**
 * Build the correctly-typed resolved intent for a given lending action.
 */
function buildResolvedIntent(
  action: LendingAction,
  chainId: TokenLendingIntent['chainId'],
  walletAddress: string,
  coinType: string,
  amount: string,
  marketId: string,
  protocol: string,
  tradeValueUsd: number,
  withdrawAll?: boolean,
): TokenLendingIntent {
  const base = { chainId, walletAddress, tradeValueUsd } as const;

  switch (action) {
    case 'lending:supply': {
      const intent: SupplyIntent = {
        ...base,
        action: 'lending:supply',
        params: { coinType, amount, protocol, marketId },
      };
      return intent;
    }
    case 'lending:borrow': {
      const intent: BorrowIntent = {
        ...base,
        action: 'lending:borrow',
        params: { coinType, amount, protocol, marketId },
      };
      return intent;
    }
    case 'lending:withdraw': {
      const intent: WithdrawIntent = {
        ...base,
        action: 'lending:withdraw',
        params: {
          coinType,
          amount,
          protocol,
          marketId,
          ...(withdrawAll === true ? { withdrawAll: true } : {}),
        },
      };
      return intent;
    }
    case 'lending:repay': {
      const intent: RepayIntent = {
        ...base,
        action: 'lending:repay',
        params: { coinType, amount, protocol, marketId },
      };
      return intent;
    }
  }
}
