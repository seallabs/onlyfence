import BigNumber from 'bignumber.js';
import { extractTokenSymbol } from '../../utils/index.js';

/**
 * Sui mainnet coin type addresses for well-known tokens.
 *
 * These are the fully-qualified Move type identifiers used on-chain.
 * Format: <package_id>::<module>::<struct>
 */
export const SUI_TOKEN_MAP: Readonly<Record<string, string>> = {
  SUI: '0x2::sui::SUI',

  // USDC (native, issued by Circle via Wormhole bridge on Sui)
  USDC: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',

  // USDT (bridged via Wormhole)
  USDT: '0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN',

  // DEEP (DeepBook protocol token)
  DEEP: '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP',

  // BLUE (BlueMove token)
  // TODO: Verify this is the correct mainnet address for BLUE token
  BLUE: '0xe1b45a0e641b9955a20aa0ad1c1f4ad86aad8afb07296d4085e349a50e90bdca::blue::BLUE',

  // WAL (Walrus token)
  WAL: '0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL',
};

/**
 * Reverse mapping from coin type address to symbol.
 * Built once at module load from SUI_TOKEN_MAP.
 */
const COIN_TYPE_TO_SYMBOL = new Map<string, string>(
  Object.entries(SUI_TOKEN_MAP).map(([symbol, coinType]) => [coinType, symbol]),
);

/**
 * Resolve a coin type address back to its human-readable symbol.
 *
 * @param coinType - Fully-qualified Sui coin type (e.g., "0x2::sui::SUI")
 * @returns The token symbol, or undefined if not in the registry
 */
export function coinTypeToSymbol(coinType: string): string | undefined {
  return COIN_TYPE_TO_SYMBOL.get(coinType);
}

/**
 * Check whether a string is a fully-qualified Move coin type (contains "::").
 */
function isCoinType(input: string): boolean {
  return input.includes('::');
}

/**
 * Resolve a token symbol or coin type to its Sui mainnet coin type address.
 *
 * If the input already contains "::" it is treated as a raw coin type and
 * returned as-is. Otherwise it is looked up (case-insensitively) as a symbol
 * alias in SUI_TOKEN_MAP.
 *
 * @param symbolOrCoinType - Token symbol (e.g., "SUI", "sui") or fully-qualified coin type
 * @returns The fully-qualified Sui coin type address
 * @throws if the input is a symbol that is not found in the registry
 */
export function resolveTokenAddress(symbolOrCoinType: string): string {
  if (isCoinType(symbolOrCoinType)) {
    return symbolOrCoinType;
  }
  const upper = symbolOrCoinType.toUpperCase();
  const address = SUI_TOKEN_MAP[upper];
  if (address === undefined) {
    throw new Error(
      `Unknown Sui token symbol "${symbolOrCoinType}". Known tokens: ${Object.keys(SUI_TOKEN_MAP).join(', ')}`,
    );
  }
  return address;
}

/**
 * Known decimals for well-known Sui tokens, keyed by fully-qualified coin type.
 */
export const SUI_KNOWN_DECIMALS: Readonly<Record<string, number>> = Object.fromEntries(
  (
    [
      ['SUI', 9],
      ['USDC', 6],
      ['USDT', 6],
      ['DEEP', 6],
      ['BLUE', 9],
      ['WAL', 9],
    ] as const
  ).map(([symbol, decimals]) => {
    const coinType = SUI_TOKEN_MAP[symbol];
    if (coinType === undefined) {
      throw new Error(`SUI_KNOWN_DECIMALS: missing token map entry for "${symbol}"`);
    }
    return [coinType, decimals] as const;
  }),
);

/**
 * Resolve a coin type to its human-readable symbol.
 * Falls back to extracting the last segment of the coin type (e.g., "SUI" from "0x2::sui::SUI").
 */
export function resolveSymbol(coinType: string): string {
  const known = COIN_TYPE_TO_SYMBOL.get(coinType);
  if (known !== undefined) return known;
  return extractTokenSymbol(coinType);
}

/**
 * Get known decimals for a coin type, or undefined if not in the registry.
 */
export function getKnownDecimals(coinType: string): number | undefined {
  return SUI_KNOWN_DECIMALS[coinType];
}

/**
 * Scale a human-readable amount to the token's smallest unit.
 * E.g., scaleToSmallestUnit("100.5", 9) → "100500000000" (100.5 * 10^9)
 *
 * The caller is responsible for providing the correct decimals value
 * (from remote API, cache, or local fallback). This decouples scaling
 * from decimal resolution.
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
 * E.g., formatAmountWithDecimals("100500000000", 9) → "100.5"
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

/**
 * Format a smallest-unit amount string to a human-readable value.
 * E.g., formatSmallestUnit("100500000000", "0x2::sui::SUI") → "100.5"
 *
 * Falls back to the raw string when decimals are unknown.
 */
export function formatSmallestUnit(raw: string, coinType: string): string {
  const decimals = getKnownDecimals(coinType);
  if (decimals === undefined) return raw;
  return formatAmountWithDecimals(raw, decimals);
}

/**
 * Check whether a token symbol is known in the Sui token registry.
 */
export function isKnownToken(symbol: string): boolean {
  return symbol in SUI_TOKEN_MAP;
}
