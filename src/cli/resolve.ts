/**
 * CLI input resolution utilities.
 *
 * All token alias resolution, coin type normalization, and amount scaling
 * MUST happen at the command boundary before constructing intents.
 * The rest of the pipeline receives only canonical, validated values.
 */

import type { ChainAdapter } from '../chain/adapter.js';
import { scaleToSmallestUnit } from '../chain/sui/tokens.js';
import type { CoinMetadataService } from '../data/coin-metadata.js';

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
 * 2. Decimal fetching (remote API with local fallback)
 * 3. Amount scaling from human-readable to smallest unit (floor-rounded)
 * 4. Symbol resolution for downstream use (oracle, logging)
 *
 * Resolution is chain-agnostic — the ChainAdapter handles chain-specific
 * alias lookup and address normalization.
 *
 * @param rawToken - User-provided token alias ("SUI", "sui") or coin type ("0x2::sui::SUI")
 * @param rawAmount - Human-readable amount string (e.g., "1.5")
 * @param chainAdapter - Chain adapter providing token resolution
 * @param coinMetadataService - Service for resolving token decimals
 * @returns Fully resolved and validated token input
 * @throws On unknown token, invalid amount, or decimal resolution failure
 */
export async function resolveTokenInput(
  rawToken: string,
  rawAmount: string,
  chainAdapter: ChainAdapter,
  coinMetadataService: CoinMetadataService,
): Promise<ResolvedTokenInput> {
  const coinType = chainAdapter.resolveTokenAddress(rawToken);
  const symbol = chainAdapter.resolveTokenSymbol(coinType);
  const decimals = await coinMetadataService.getDecimals(coinType, chainAdapter.chain);
  const scaledAmount = scaleToSmallestUnit(rawAmount, decimals);

  return { coinType, symbol, decimals, scaledAmount };
}
