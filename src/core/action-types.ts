/**
 * Core action intent types for the OnlyFence transaction pipeline.
 * ActionIntent is the single intent type used across the entire system:
 * pipeline, policy engine, builders, and trade logging.
 */

/** Supported DeFi actions -- extend this union to add new action types */
export type DeFiAction =
  | 'swap'
  | 'supply'
  | 'borrow'
  | 'withdraw'
  | 'repay'
  | 'claim_rewards'
  | 'lp_deposit'
  | 'lp_withdraw';
export type Chain = 'sui';
export type ChainId = `${Chain}:${string}`;
export type LendingProtocol = 'alphalend' | 'suilend' | 'navi';
export type DexProtocol = 'cetus_clmm' | 'bluefin_clmm';
export type AggregatorProtocol = '7k_meta_ag';
export type DefiProtocol = LendingProtocol | DexProtocol | AggregatorProtocol;

/** Base intent -- all actions share these fields */
export interface ActionIntentBase {
  readonly chainId: ChainId;
  readonly action: DeFiAction;
  readonly walletAddress: string;
}

/** Swap-specific intent */
export interface SwapIntent extends ActionIntentBase {
  readonly action: 'swap';
  readonly params: {
    readonly coinTypeIn: string;
    readonly coinTypeOut: string;
    readonly amountIn: string;
    readonly slippageBps: number;
  };
  readonly tradeValueUsd?: number | undefined;
}

/** Supply-specific intent */
export interface SupplyIntent extends ActionIntentBase {
  readonly action: 'supply';
  readonly params: {
    readonly coinType: string;
    readonly amount: string;
    readonly protocol: string;
    readonly marketId: string;
  };
  readonly valueUsd?: number | undefined;
}

/** Borrow-specific intent */
export interface BorrowIntent extends ActionIntentBase {
  readonly action: 'borrow';
  readonly params: {
    readonly coinType: string;
    readonly amount: string;
    readonly protocol: string;
    readonly marketId: string;
  };
  readonly valueUsd?: number | undefined;
}

/** Withdraw-specific intent */
export interface WithdrawIntent extends ActionIntentBase {
  readonly action: 'withdraw';
  readonly params: {
    readonly coinType: string;
    readonly amount: string;
    readonly protocol: string;
    readonly marketId: string;
    readonly withdrawAll?: boolean;
  };
  readonly valueUsd?: number | undefined;
}

/** Repay-specific intent */
export interface RepayIntent extends ActionIntentBase {
  readonly action: 'repay';
  readonly params: {
    readonly coinType: string;
    readonly amount: string;
    readonly protocol: string;
    readonly marketId: string;
  };
  readonly valueUsd?: number | undefined;
}

/** Claim rewards intent — no specific token or amount */
export interface ClaimRewardsIntent extends ActionIntentBase {
  readonly action: 'claim_rewards';
  readonly params: {
    readonly protocol: string;
  };
}

/** Discriminated union -- the single intent type used everywhere */
export type ActionIntent =
  | SwapIntent
  | SupplyIntent
  | BorrowIntent
  | WithdrawIntent
  | RepayIntent
  | ClaimRewardsIntent;

/** Pipeline result status */
export type PipelineStatus = 'success' | 'simulated' | 'rejected' | 'simulation_failed' | 'error';

/** Result returned by executePipeline */
export interface PipelineResult {
  readonly status: PipelineStatus;
  readonly metadata?: Record<string, unknown>;
  readonly txDigest?: string;
  readonly gasUsed?: number;
  readonly error?: string;
  readonly rejectionCheck?: string;
  readonly rejectionReason?: string;
}
