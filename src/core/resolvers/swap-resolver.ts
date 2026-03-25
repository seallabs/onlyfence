/**
 * SwapIntentResolver: resolves raw swap inputs into canonical values.
 *
 * Handles: token symbol → coin type, human amount → smallest unit,
 * slippage parsing, and USD price computation.
 */

import type { ActivityAction, SwapIntent } from '../action-types.js';
import type { IntentResolver, ResolvedExecution, ResolverDeps } from '../intent-resolver.js';
import { resolveTokenInput } from '../../cli/resolve.js';

export class SwapIntentResolver implements IntentResolver {
  readonly supportedActions: readonly ActivityAction[] = ['trade:swap'];

  async resolve(rawIntent: SwapIntent, deps: ResolverDeps): Promise<ResolvedExecution> {
    const { chainAdapter, dataProvider, walletAddress } = deps;
    const rawParams = rawIntent.params;

    const resolvedIn = await resolveTokenInput(
      rawParams.coinTypeIn,
      rawParams.amountIn,
      chainAdapter,
      dataProvider,
    );
    const coinTypeOut = chainAdapter.resolveTokenAddress(rawParams.coinTypeOut);
    const price = await dataProvider.getPrice(resolvedIn.coinType);
    const tradeValueUsd = parseFloat(rawParams.amountIn) * price;

    const resolvedIntent: SwapIntent = {
      chainId: rawIntent.chainId,
      action: 'trade:swap',
      walletAddress,
      params: {
        coinTypeIn: resolvedIn.coinType,
        coinTypeOut,
        amountIn: resolvedIn.scaledAmount,
        slippageBps: rawParams.slippageBps,
      },
      tradeValueUsd,
    };

    return { intent: resolvedIntent, tradeValueUsd };
  }
}
