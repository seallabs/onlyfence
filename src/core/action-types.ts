/**
 * Core action intent types for the OnlyFence transaction pipeline.
 * ActionIntent is the single intent type used across the entire system:
 * pipeline, policy engine, builders, and trade logging.
 */

/** Supported DeFi actions -- extend this union to add new action types */
export type DeFiAction = 'swap' | 'supply' | 'lp_deposit' | 'lp_withdraw';
export type Chain = 'sui';
export type ChainId = `${Chain}:${string}`;

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

/** Supply-specific intent (future -- included for union completeness) */
export interface SupplyIntent extends ActionIntentBase {
  readonly action: 'supply';
  readonly params: {
    readonly coinType: string;
    readonly amount: string;
    readonly protocol: string;
  };
}

/** Discriminated union -- the single intent type used everywhere */
export type ActionIntent = SwapIntent | SupplyIntent;

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
