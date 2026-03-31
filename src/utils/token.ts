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

/**
 * Format a smallest-unit amount string to a human-readable decimal value.
 *
 * This is a chain-agnostic utility — it only performs string-based decimal
 * placement. No chain-specific token registry lookups are involved.
 *
 * E.g., formatAmountWithDecimals("100500000000", 9) -> "100.5"
 *
 * @param raw - Amount in smallest unit as a string (e.g., "100500000000")
 * @param decimals - Number of decimal places for the token
 * @param maxFracDigits - Optional cap on fractional digits shown
 */
export function formatAmountWithDecimals(
  raw: string,
  decimals: number,
  maxFracDigits?: number,
): string {
  if (decimals === 0) return raw;

  const padded = raw.padStart(decimals + 1, '0');
  const intPart = padded.slice(0, padded.length - decimals);
  const frac = padded.slice(padded.length - decimals);
  const trimmed = maxFracDigits !== undefined ? frac.slice(0, maxFracDigits) : frac;
  const fracPart = trimmed.replace(/0+$/, '');
  return fracPart.length > 0 ? `${intPart}.${fracPart}` : intPart;
}
