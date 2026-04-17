/**
 * EVM (Ethereum mainnet) token registry — the single source of truth
 * for alias ↔ address ↔ decimals across the EVM chain module.
 */

export type EvmAddress = `0x${string}`;

/**
 * Paraswap and most EVM aggregators use this sentinel in place of a
 * real contract address when the input or output token is native ETH.
 */
export const EVM_NATIVE_ETH_ADDRESS: EvmAddress = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

export interface EvmTokenEntry {
  readonly alias: string;
  readonly address: EvmAddress;
  readonly decimals: number;
}

const EVM_TOKEN_REGISTRY: readonly EvmTokenEntry[] = [
  // Native ETH is represented by the placeholder address used by Paraswap
  // and most EVM aggregators.
  { alias: 'ETH', address: EVM_NATIVE_ETH_ADDRESS, decimals: 18 },
  { alias: 'WETH', address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18 },
  { alias: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
  { alias: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
  { alias: 'DAI', address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18 },
  { alias: 'WBTC', address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8 },
];

/** Alias (uppercased) -> canonical address. */
const ALIAS_TO_ADDRESS = new Map<string, EvmAddress>(
  EVM_TOKEN_REGISTRY.map((t) => [t.alias.toUpperCase(), t.address]),
);

/** Lowercased address -> alias. Normalized for case-insensitive lookup. */
const ADDRESS_TO_ALIAS = new Map<string, string>(
  EVM_TOKEN_REGISTRY.map((t) => [t.address.toLowerCase(), t.alias]),
);

/** Known decimals keyed by lowercased address for O(1) lookup. */
export const EVM_KNOWN_DECIMALS: Readonly<Record<string, number>> = Object.fromEntries(
  EVM_TOKEN_REGISTRY.map((t) => [t.address.toLowerCase(), t.decimals]),
);

/** Matches a 0x-prefixed 40-hex-character Ethereum address. */
const ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;

/**
 * Check whether a string looks like an EVM contract address.
 */
export function isEvmAddress(value: string): value is EvmAddress {
  return ADDRESS_REGEX.test(value);
}

/**
 * Resolve a token alias or raw contract address to its canonical address.
 *
 * Alias lookup is case-insensitive; raw addresses are normalized to
 * lowercase for consistent keying across downstream maps.
 *
 * @throws if the input is neither a known alias nor a valid address
 */
export function resolveTokenAddress(symbolOrAddress: string): EvmAddress {
  const fromAlias = ALIAS_TO_ADDRESS.get(symbolOrAddress.toUpperCase());
  if (fromAlias !== undefined) return fromAlias;

  if (isEvmAddress(symbolOrAddress)) {
    return symbolOrAddress.toLowerCase() as EvmAddress;
  }

  throw new Error(`Unknown EVM token: "${symbolOrAddress}"`);
}

/**
 * Try to resolve a token alias or address; returns undefined if the input
 * is not a known alias and does not look like a valid EVM address. Used by
 * the token allowlist policy check.
 */
export function tryResolveTokenAddress(symbolOrAddress: string): EvmAddress | undefined {
  const fromAlias = ALIAS_TO_ADDRESS.get(symbolOrAddress.toUpperCase());
  if (fromAlias !== undefined) return fromAlias;

  if (isEvmAddress(symbolOrAddress)) {
    return symbolOrAddress.toLowerCase() as EvmAddress;
  }

  return undefined;
}

/**
 * Resolve a canonical contract address to its registry alias.
 * Returns the normalized lowercased address if no alias is known.
 */
export function resolveSymbol(address: string): string {
  return ADDRESS_TO_ALIAS.get(address.toLowerCase()) ?? address.toLowerCase();
}

/** Look up known decimals for a canonical address. */
export function getKnownDecimals(address: string): number | undefined {
  return EVM_KNOWN_DECIMALS[address.toLowerCase()];
}

/**
 * True when the given address represents native ETH in Paraswap-compatible
 * conventions. Accepts any case.
 */
export function isNativeEth(address: string): boolean {
  return address.toLowerCase() === EVM_NATIVE_ETH_ADDRESS.toLowerCase();
}
