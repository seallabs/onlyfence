/**
 * Core action intent types for the OnlyFence transaction pipeline.
 * ActionIntent is the single intent type used across the entire system:
 * pipeline, policy engine, builders, and trade logging.
 */

/** All DeFi actions in `category:action` format — extend to add new verticals */
export type ActivityAction =
  | 'trade:swap'
  | 'lending:supply'
  | 'lending:borrow'
  | 'lending:withdraw'
  | 'lending:repay'
  | 'lending:claim_rewards'
  | 'lp:deposit'
  | 'lp:withdraw'
  | 'perp:place_order'
  | 'perp:cancel_order'
  | 'perp:filled'
  | 'perp:deposit'
  | 'perp:withdraw'
  | 'staking:stake'
  | 'staking:unstake';

/** Category prefix extracted from ActivityAction */
export type ActivityCategory = ActivityAction extends `${infer C}:${string}` ? C : never;
export type Chain = 'sui';
export type ChainId = `${Chain}:${string}`;
export type LendingProtocol = 'alphalend' | 'suilend' | 'navi';
export type DexProtocol = 'cetus_clmm' | 'bluefin_clmm';
export type AggregatorProtocol = '7k_meta_ag';
export type PerpProtocol = 'bluefin_pro';
export type DefiProtocol = LendingProtocol | DexProtocol | AggregatorProtocol | PerpProtocol;

/** Base intent -- all actions share these fields */
export interface ActionIntentBase {
  readonly chainId: ChainId;
  readonly action: ActivityAction;
  readonly walletAddress: string;
}

/** Swap-specific intent */
export interface SwapIntent extends ActionIntentBase {
  readonly action: 'trade:swap';
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
  readonly action: 'lending:supply';
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
  readonly action: 'lending:borrow';
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
  readonly action: 'lending:withdraw';
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
  readonly action: 'lending:repay';
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
  readonly action: 'lending:claim_rewards';
  readonly params: {
    readonly protocol: string;
  };
}

/** Perp order placement intent */
export interface PerpPlaceOrderIntent extends ActionIntentBase {
  readonly action: 'perp:place_order';
  readonly params: {
    readonly protocol: PerpProtocol;
    readonly marketSymbol: string;
    readonly side: 'LONG' | 'SHORT';
    readonly quantityE9: string;
    readonly orderType: 'MARKET' | 'LIMIT';
    /** When present, it must be less than or equal to market max leverage. Omit to use default leverage. */
    readonly leverageE9?: string;
    readonly limitPriceE9?: string;
    readonly reduceOnly?: boolean;
    readonly timeInForce?: 'GTT' | 'IOC' | 'FOK';
    readonly collateralCoinType: string;
    readonly marketCoinType: string;
  };
  readonly valueUsd?: number | undefined;
}

/** Perp order cancellation intent */
export interface PerpCancelOrderIntent extends ActionIntentBase {
  readonly action: 'perp:cancel_order';
  readonly params: {
    readonly protocol: PerpProtocol;
    readonly marketSymbol: string;
    readonly orderHashes?: readonly string[];
  };
}

/** Perp margin deposit intent (on-chain USDC TX) */
export interface PerpDepositIntent extends ActionIntentBase {
  readonly action: 'perp:deposit';
  readonly params: {
    readonly protocol: PerpProtocol;
    readonly coinType: string;
    /** Amount in the token's smallest unit (e.g. 100000 for 0.1 USDC with 6 decimals) */
    readonly amount: string;
    /** Token decimals -- needed to convert from native scale to Bluefin's e9 format */
    readonly decimals: number;
  };
  readonly valueUsd?: number | undefined;
}

/** Perp margin withdrawal intent (signed API call) */
export interface PerpWithdrawIntent extends ActionIntentBase {
  readonly action: 'perp:withdraw';
  readonly params: {
    readonly protocol: PerpProtocol;
    readonly assetSymbol: string;
    readonly amountE9: string;
  };
  readonly valueUsd?: number | undefined;
}

/**
 * NOTE: PerpFilledIntent is NOT added to the ActionIntent union.
 * Fills are synced directly into the activities table via syncFills(),
 * never passing through executePipeline. This type exists only as a
 * data shape for the sync logic — keeping it out of ActionIntent avoids
 * adding dead branches to every exhaustive switch (extractCoinTypes,
 * policy checks, etc.).
 */

/** Discriminated union -- the single intent type used everywhere */
export type ActionIntent =
  | SwapIntent
  | SupplyIntent
  | BorrowIntent
  | WithdrawIntent
  | RepayIntent
  | ClaimRewardsIntent
  | PerpPlaceOrderIntent
  | PerpCancelOrderIntent
  | PerpDepositIntent
  | PerpWithdrawIntent;

/** Lending actions that take token + amount args. */
export type LendingAction =
  | 'lending:supply'
  | 'lending:borrow'
  | 'lending:withdraw'
  | 'lending:repay';

/** Intent type for token-based lending actions (excludes claim_rewards). */
export type TokenLendingIntent = SupplyIntent | BorrowIntent | WithdrawIntent | RepayIntent;

/**
 * Extract all coin types referenced by an intent.
 * Used by the pipeline to ensure coin metadata is cached for activity display.
 */
export function extractCoinTypes(intent: ActionIntent): string[] {
  switch (intent.action) {
    case 'trade:swap':
      return [intent.params.coinTypeIn, intent.params.coinTypeOut];
    case 'lending:claim_rewards':
    case 'perp:cancel_order':
    case 'perp:withdraw':
      return [];
    case 'lending:supply':
    case 'lending:borrow':
    case 'lending:withdraw':
    case 'lending:repay':
    case 'perp:deposit':
      return [intent.params.coinType];
    case 'perp:place_order':
      return [intent.params.collateralCoinType, intent.params.marketCoinType];
  }
}

/** Pipeline result status */
export type PipelineStatus =
  | 'success'
  | 'acknowledged'
  | 'simulated'
  | 'rejected'
  | 'simulation_failed'
  | 'error';

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
