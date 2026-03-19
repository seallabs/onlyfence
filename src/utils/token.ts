/**
 * Extract the trailing symbol from a fully-qualified coin type.
 *
 * Works with any Move-style coin type (e.g. "0x2::sui::SUI" → "SUI").
 * This is chain-agnostic — it only relies on the `::` separator convention.
 *
 * @param coinType - Fully-qualified coin type string
 * @returns The last segment (symbol), or the original string if no `::` found
 */
export function extractTokenSymbol(coinType: string): string {
  const parts = coinType.split('::');
  return parts[parts.length - 1] ?? coinType;
}

/**
 * Parse a comma-separated token string into a trimmed, non-empty array.
 *
 * @param raw - Comma-separated token string (e.g., "SUI, USDC, USDT")
 * @returns Array of trimmed token strings with empty entries removed
 */
export function parseTokenList(raw: string): string[] {
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}
