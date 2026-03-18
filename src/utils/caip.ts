/**
 * Utility for formatting CAIP-19 asset identifiers.
 *
 * CAIP-2: {namespace}:{reference}          e.g. "sui:mainnet", "eip155:1"
 * CAIP-19: {caip2}/{asset_namespace}:{asset_reference}
 *          e.g. "sui:mainnet/coin:0x2::sui::SUI"
 *
 * @see https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-19.md
 */

/**
 * Format a CAIP-19 asset identifier from its components.
 *
 * @param chainId - CAIP-2 chain identifier (e.g., "sui:mainnet")
 * @param assetNamespace - Asset namespace (e.g., "coin", "erc20", "spl")
 * @param assetReference - On-chain asset reference (e.g., "0x2::sui::SUI")
 * @returns Fully qualified CAIP-19 string
 */
export function formatCAIP19(
  chainId: string,
  assetNamespace: string,
  assetReference: string,
): string {
  return `${chainId}/${assetNamespace}:${assetReference}`;
}
