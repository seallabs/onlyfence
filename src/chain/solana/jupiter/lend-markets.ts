/**
 * Resolve a lending market ID for a given token on Jupiter Lend.
 *
 * Uses @jup-ag/lend/earn to discover available lending tokens and
 * maps them to vault IDs. For earn (deposit/withdraw), the market ID
 * is the mint address itself. For borrow, it's a numeric vault ID.
 *
 * @param coinType - Token mint address
 * @param explicitMarketId - Optional explicit market ID override
 * @returns Resolved market ID string
 */
export function resolveJupiterLendMarketId(
  coinType: string,
  explicitMarketId?: string,
): Promise<string> {
  // If an explicit market ID was provided, use it directly
  if (explicitMarketId !== undefined && explicitMarketId !== '') {
    return Promise.resolve(explicitMarketId);
  }

  // For Jupiter Lend earn operations, the market ID is the mint address
  // The SDK resolves the correct vault internally from the asset PublicKey
  return Promise.resolve(coinType);
}
