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
 * Resolve a token symbol to its Sui mainnet coin type address.
 *
 * @param symbol - The token symbol (case-sensitive, e.g., "SUI", "USDC")
 * @returns The fully-qualified Sui coin type address
 * @throws if the symbol is not found in the registry
 */
export function resolveTokenAddress(symbol: string): string {
  const address = SUI_TOKEN_MAP[symbol];
  if (address === undefined) {
    throw new Error(
      `Unknown Sui token symbol "${symbol}". Known tokens: ${Object.keys(SUI_TOKEN_MAP).join(', ')}`,
    );
  }
  return address;
}

/**
 * Check whether a token symbol is known in the Sui token registry.
 */
export function isKnownToken(symbol: string): boolean {
  return symbol in SUI_TOKEN_MAP;
}
