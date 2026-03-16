/**
 * Supported trade actions in the OnlyFence system.
 */
export type TradeAction = 'swap' | 'lp_deposit' | 'lp_withdraw';

/**
 * Represents a trade intent submitted by an agent or user.
 * This is the primary input to the policy engine pipeline.
 */
export interface TradeIntent {
  /** Target blockchain (e.g., "sui", "evm", "solana") */
  readonly chain: string;

  /** The type of trade action to perform */
  readonly action: TradeAction;

  /** Source token identifier */
  readonly fromToken: string;

  /** Destination token identifier */
  readonly toToken: string;

  /** Amount of fromToken in smallest unit (e.g., MIST for SUI) */
  readonly amount: bigint;

  /** Protocol to use (e.g., "7k", "cetus", "deepbook") */
  readonly protocol?: string;

  /** Specific pool address */
  readonly pool?: string;

  /** Wallet address executing the trade */
  readonly walletAddress: string;
}
