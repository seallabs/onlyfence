import BigNumber from 'bignumber.js';

/**
 * Deterministic synthetic address prefix for Bluefin Pro markets.
 * "bf1bef" mnemonic for "bluefin", repeated to fill 64 hex chars.
 * These are NOT real Sui objects — they exist only in the local coin_metadata table.
 */
export const BLUEFIN_SYNTHETIC_PREFIX =
  '0xbf1befbf1befbf1befbf1befbf1befbf1befbf1befbf1befbf1befbf1befbf1b';

/** Decimals for all Bluefin synthetic coins (matches e9 format). */
export const BLUEFIN_DECIMALS = 9;

/**
 * Generate a synthetic coin type for a Bluefin Pro market base asset.
 * Example: toBluefinCoinType('BTC') → '0xbf1bef...::bluefin_pro::BTC'
 */
export function toBluefinCoinType(baseAsset: string): string {
  return `${BLUEFIN_SYNTHETIC_PREFIX}::bluefin_pro::${baseAsset}`;
}

/**
 * Check whether a coin type is a Bluefin synthetic.
 */
export function isBluefinSynthetic(coinType: string): boolean {
  return coinType.startsWith(BLUEFIN_SYNTHETIC_PREFIX);
}

/**
 * Extract the base asset from a Bluefin market symbol.
 * 'BTC-PERP' → 'BTC', 'ETH-PERP' → 'ETH'
 */
export function parseBluefinMarketSymbol(symbol: string): string {
  const parts = symbol.split('-');
  if (parts.length !== 2 || parts[1] !== 'PERP') {
    throw new Error(`Invalid Bluefin market symbol "${symbol}": expected format "BASE-PERP"`);
  }
  const base = parts[0];
  if (base === undefined || base === '') {
    throw new Error(`Invalid Bluefin market symbol "${symbol}": empty base asset`);
  }
  return base;
}

// Re-export shared e9 utilities for backward compatibility.
// Canonical definitions live in src/utils/bigint.ts.
export { toE9, fromE9 } from '../../../utils/bigint.js';

/**
 * Convert a native-scaled amount (in the token's smallest unit) to Bluefin e9 format.
 * Accounts for the difference between the token's decimals and Bluefin's 9 decimals.
 *
 * Example: USDC has 6 decimals.
 *   0.1 USDC → native scaled = '100000' (1e5)
 *   nativeToE9('100000', 6) → '100000000' (1e8) = 0.1 in e9
 *
 * Formula: e9 = nativeAmount × 10^(9 - decimals)
 */
export function nativeToE9(nativeAmount: string, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > BLUEFIN_DECIMALS) {
    throw new Error(
      `nativeToE9: decimals must be an integer between 0 and ${BLUEFIN_DECIMALS}, got ${decimals}`,
    );
  }
  const scale = BLUEFIN_DECIMALS - decimals;
  if (scale === 0) return nativeAmount;
  return new BigNumber(nativeAmount).times(new BigNumber(10).pow(scale)).toFixed(0);
}

/** Bluefin order side. */
export type BluefinSide = 'LONG' | 'SHORT';

/** Bluefin order type. */
export type BluefinOrderType = 'MARKET' | 'LIMIT';

/** Bluefin time-in-force. */
export type BluefinTimeInForce = 'GTT' | 'IOC' | 'FOK';

import type { ActivityAction, ChainId, DefiProtocol } from '../../../core/action-types.js';

interface BluefinActivityBaseResult {
  readonly chain_id: ChainId;
  readonly wallet_address: string;
  readonly action: ActivityAction;
  readonly protocol: DefiProtocol;
  readonly policy_decision: 'approved' | 'rejected';
  readonly rejection_reason?: string | undefined;
  readonly rejection_check?: string | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
}

/**
 * Build the base activity record fields shared by all Bluefin builders.
 * Centralizes the rejection spread and common fields.
 */
export function bluefinActivityBase(
  intent: { chainId: ChainId; walletAddress: string },
  action: ActivityAction,
  context: {
    status: 'approved' | 'rejected';
    rejection?: { reason: string; check: string };
    metadata?: Record<string, unknown>;
  },
): BluefinActivityBaseResult {
  return {
    chain_id: intent.chainId,
    wallet_address: intent.walletAddress,
    action,
    protocol: 'bluefin_pro',
    policy_decision: context.status,
    ...(context.rejection !== undefined
      ? {
          rejection_reason: context.rejection.reason,
          rejection_check: context.rejection.check,
        }
      : {}),
    metadata: context.metadata,
  };
}

/** Shape of metadata stored for a perp:filled activity row. */
export interface PerpFilledMetadata {
  readonly marketSymbol: string;
  readonly side: BluefinSide;
  readonly fillPrice: string;
  readonly fillQuantity: string;
  readonly leverage: string;
  readonly fee: string;
  readonly orderHash: string;
  readonly tradeId: string;
  readonly isClose: boolean;
}

/** Shape of metadata stored for a perp:place_order activity row. */
export interface PerpPlaceOrderMetadata {
  readonly marketSymbol: string;
  readonly side: BluefinSide;
  readonly orderType: BluefinOrderType;
  readonly orderHash: string;
  readonly priceE9: string;
  readonly quantityE9: string;
  readonly leverageE9: string;
  readonly timeInForce: BluefinTimeInForce;
  readonly reduceOnly: boolean;
}

/** Shape of metadata stored for a perp:cancel_order activity row. */
export interface PerpCancelOrderMetadata {
  readonly marketSymbol: string;
  readonly orderHashes: readonly string[];
  readonly cancelAll: boolean;
}
