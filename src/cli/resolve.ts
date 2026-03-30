/**
 * CLI input resolution utilities.
 *
 * All token alias resolution, coin type normalization, and amount scaling
 * MUST happen at the command boundary before constructing intents.
 * The rest of the pipeline receives only canonical, validated values.
 */

import type { ChainAdapter } from '../chain/adapter.js';
import type { DataProvider } from '../core/data-provider.js';
import { scaleToSmallestUnit } from '../utils/token.js';

/**
 * Fully resolved token input — the canonical representation used
 * by intents, builders, and the rest of the pipeline.
 */
export interface ResolvedTokenInput {
  /** Fully-qualified, normalized coin type (e.g., "0x2::sui::SUI") */
  readonly coinType: string;
  /** Human-readable symbol from the registry (e.g., "SUI", "haSUI") */
  readonly symbol: string;
  /** Number of decimal places for this token */
  readonly decimals: number;
  /** Amount in the token's smallest unit, floor-rounded (e.g., "1234000000") */
  readonly scaledAmount: string;
}

/**
 * Resolve raw CLI token + amount inputs into canonical internal representations.
 *
 * This is the single entry point for all command handlers to normalize user input.
 * It performs:
 * 1. Token alias resolution (case-insensitive) or coin type normalization
 * 2. Metadata fetching (decimals, symbol) via DataProvider
 * 3. Amount scaling from human-readable to smallest unit (floor-rounded)
 *
 * Resolution is chain-agnostic — the ChainAdapter handles chain-specific
 * alias lookup and address normalization.
 *
 * @param rawToken - User-provided token alias ("SUI", "sui") or coin type ("0x2::sui::SUI")
 * @param rawAmount - Human-readable amount string (e.g., "1.5")
 * @param chainAdapter - Chain adapter providing token resolution
 * @param dataProvider - Data provider for resolving token metadata
 * @returns Fully resolved and validated token input
 * @throws On unknown token, invalid amount, or metadata resolution failure
 */
export async function resolveTokenInput(
  rawToken: string,
  rawAmount: string,
  chainAdapter: ChainAdapter,
  dataProvider: DataProvider,
): Promise<ResolvedTokenInput> {
  const coinType = chainAdapter.resolveTokenAddress(rawToken);
  const meta = await dataProvider.getMetadata(coinType);
  const symbol = meta.symbol;
  const scaledAmount = scaleToSmallestUnit(rawAmount, meta.decimals);

  return { coinType, symbol, decimals: meta.decimals, scaledAmount };
}
