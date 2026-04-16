import { resolveTokenAddress } from '../tokens.js';

/**
 * Resolve an Aave V3 market id. Aave V3 keeps a single market per
 * underlying reserve per deployment, so the stable id is just the
 * canonical reserve address — aliases like `USDC` pass through the
 * token registry resolver.
 */
export function resolveAaveV3MarketId(
  coinType: string,
  explicitMarketId?: string,
): Promise<string> {
  if (explicitMarketId !== undefined && explicitMarketId !== '') {
    return Promise.resolve(explicitMarketId);
  }
  return Promise.resolve(resolveTokenAddress(coinType));
}
