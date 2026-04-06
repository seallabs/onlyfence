/**
 * Token entry in the Solana token registry.
 */
export interface SolanaTokenEntry {
  readonly alias: string;
  readonly mintAddress: string;
  readonly decimals: number;
}

/**
 * Canonical registry of well-known Solana mainnet tokens.
 * Single source of truth -- maps and helpers are derived from this.
 */
const SOLANA_TOKEN_REGISTRY: readonly SolanaTokenEntry[] = [
  {
    alias: 'SOL',
    mintAddress: 'So11111111111111111111111111111111111111112',
    decimals: 9,
  },
  {
    alias: 'USDC',
    mintAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    decimals: 6,
  },
  {
    alias: 'USDT',
    mintAddress: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    decimals: 6,
  },
  {
    alias: 'JitoSOL',
    mintAddress: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
    decimals: 9,
  },
  {
    alias: 'JupSOL',
    mintAddress: 'jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v',
    decimals: 9,
  },
  {
    alias: 'wETH',
    mintAddress: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs',
    decimals: 8,
  },
  {
    alias: 'wBTC',
    mintAddress: '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh',
    decimals: 8,
  },
];

/** Alias (case-insensitive) -> mint address */
const ALIAS_TO_MINT = new Map<string, string>(
  SOLANA_TOKEN_REGISTRY.map((t) => [t.alias.toUpperCase(), t.mintAddress]),
);

/** Mint address -> alias */
const MINT_TO_ALIAS = new Map<string, string>(
  SOLANA_TOKEN_REGISTRY.map((t) => [t.mintAddress, t.alias]),
);

/** Known decimals by mint address */
export const SOLANA_KNOWN_DECIMALS: Readonly<Record<string, number>> = Object.fromEntries(
  SOLANA_TOKEN_REGISTRY.map((t) => [t.mintAddress, t.decimals]),
);

/**
 * Resolve a token alias or raw mint address to its canonical mint address.
 *
 * Accepts both human-readable aliases ("SOL", "USDC") and raw mint addresses.
 * Alias lookup is case-insensitive.
 *
 * @param symbolOrAddress - Token alias or raw mint address
 * @returns Canonical mint address string
 * @throws if the input cannot be resolved as an alias and doesn't look like a valid address
 */
export function resolveTokenAddress(symbolOrAddress: string): string {
  const upper = symbolOrAddress.toUpperCase();
  const fromAlias = ALIAS_TO_MINT.get(upper);
  if (fromAlias !== undefined) return fromAlias;

  // Pass through raw mint addresses (base58 public keys are 32-44 chars)
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(symbolOrAddress)) {
    return symbolOrAddress;
  }

  throw new Error(`Unknown Solana token: "${symbolOrAddress}"`);
}

/**
 * Try to resolve a token alias to its mint address.
 * Returns undefined if the alias is not in the registry.
 *
 * Used by the policy engine's token allowlist check.
 */
export function tryResolveTokenAddress(symbolOrAddress: string): string | undefined {
  const upper = symbolOrAddress.toUpperCase();
  const fromAlias = ALIAS_TO_MINT.get(upper);
  if (fromAlias !== undefined) return fromAlias;

  // If it looks like a valid mint address, pass through
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(symbolOrAddress)) {
    return symbolOrAddress;
  }

  return undefined;
}

/**
 * Resolve a canonical mint address back to its human-readable symbol.
 *
 * Returns the registry alias when the mint is known, otherwise returns the address as-is.
 */
export function resolveSymbol(mintAddress: string): string {
  return MINT_TO_ALIAS.get(mintAddress) ?? mintAddress;
}

/**
 * Get known decimals for a mint address, if available.
 */
export function getKnownDecimals(mintAddress: string): number | undefined {
  return SOLANA_KNOWN_DECIMALS[mintAddress];
}
