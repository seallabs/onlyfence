import BigNumber from 'bignumber.js';

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
 * Scale a human-readable amount to the token's smallest unit.
 *
 * E.g., scaleToSmallestUnit("100.5", 9) -> "100500000000" (100.5 * 10^9)
 *
 * @param humanAmount - Human-readable amount string (e.g., "100.5")
 * @param decimals - Number of decimal places for the token
 * @returns The amount in the token's smallest unit as a string
 * @throws if the amount is not a valid positive number
 */
export function scaleToSmallestUnit(humanAmount: string, decimals: number): string {
  const float = parseFloat(humanAmount);
  if (isNaN(float) || float <= 0) {
    throw new Error(`Invalid amount "${humanAmount}": must be a positive number`);
  }
  const scaled = BigNumber(float)
    .times(10 ** decimals)
    .integerValue(BigNumber.ROUND_FLOOR)
    .toString();
  return scaled;
}

/**
 * Format a raw smallest-unit amount string to a human-readable value
 * given the number of decimal places.
 *
 * E.g., formatAmountWithDecimals("100500000000", 9) -> "100.5"
 *
 * @param raw - Amount in smallest unit as a string
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
