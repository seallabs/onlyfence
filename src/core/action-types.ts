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

/** Preview returned by ActionBuilder.preview() */
export interface ActionPreviewBase {
  readonly action: DeFiAction;
}
export interface SwapPreview extends ActionPreviewBase {
  readonly action: 'swap';
  readonly description: string;
  readonly expectedOutput: string;
  readonly provider: string;
  readonly priceImpact?: number;
  readonly buildData: unknown;
}

/** Result returned by executePipeline */
export interface PipelineResult<Preview extends ActionPreviewBase = ActionIntentBase> {
  readonly status: PipelineStatus;
  readonly preview?: Preview;
  readonly txDigest?: string;
  readonly gasUsed?: number;
  readonly error?: string;
  readonly rejectionCheck?: string;
  readonly rejectionReason?: string;
}
