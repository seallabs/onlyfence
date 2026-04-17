import type {
  ActionBuilder,
  BuiltTransaction,
  FinishContext,
} from '../../../core/action-builder.js';
import type { PerpPlaceOrderIntent } from '../../../core/action-types.js';
import type { ActivityLog } from '../../../db/activity-log.js';
import { fromE9 } from '../../../utils/bigint.js';
import type { HyperliquidClient } from './client.js';

/**
 * Far-outside-range price used with IOC to emulate a market order.
 * Hyperliquid rejects zero-priced orders; any sufficiently large value
 * sends an "execute at best price" signal when paired with IOC.
 */
const MARKET_ORDER_SENTINEL_PRICE = 999_999;

/**
 * Hyperliquid perp place-order builder.
 *
 * - Market orders → IOC limit orders with a sentinel price.
 * - Limit orders pass `limitPriceE9` through verbatim.
 * - `reduce_only` powers the "close position" path (opposite side + reduceOnly).
 */
export class HyperliquidPlaceOrderBuilder implements ActionBuilder<PerpPlaceOrderIntent> {
  readonly builderId = 'hyperliquid-place-order';
  readonly chain = 'ethereum';
  readonly executionStrategy = 'off-chain-signed' as const;

  constructor(
    private readonly getClient: () => HyperliquidClient,
    private readonly activityLog: ActivityLog,
  ) {}

  validate(intent: PerpPlaceOrderIntent): void {
    if (intent.params.marketSymbol === '') {
      throw new Error('marketSymbol is required');
    }
    if (intent.params.quantityE9 === '0' || intent.params.quantityE9 === '') {
      throw new Error('quantity must be greater than zero');
    }
    if (intent.params.orderType === 'LIMIT' && intent.params.limitPriceE9 === undefined) {
      throw new Error('limitPriceE9 is required for LIMIT orders');
    }
  }

  build(_intent: PerpPlaceOrderIntent): Promise<BuiltTransaction> {
    return Promise.resolve({ transaction: null, metadata: {} });
  }

  async execute(intent: PerpPlaceOrderIntent): Promise<{ metadata: Record<string, unknown> }> {
    const client = this.getClient();
    const { params } = intent;

    const coin = params.marketSymbol.split('-')[0] ?? params.marketSymbol;

    const size = fromE9(params.quantityE9);
    if (!(size > 0)) {
      throw new Error(`Invalid order size ${params.quantityE9}`);
    }

    const limitPrice =
      params.orderType === 'LIMIT' && params.limitPriceE9 !== undefined
        ? fromE9(params.limitPriceE9)
        : MARKET_ORDER_SENTINEL_PRICE;

    const tif = params.timeInForce === 'GTT' ? 'Gtc' : 'Ioc';

    const response: unknown = await client.sdk.exchange.placeOrder({
      coin,
      is_buy: params.side === 'LONG',
      sz: size,
      limit_px: limitPrice,
      order_type: { limit: { tif } },
      reduce_only: params.reduceOnly ?? false,
    });

    return {
      metadata: {
        txDigest: safeHashFrom(response),
        marketSymbol: params.marketSymbol,
        side: params.side,
        size,
        limitPrice,
        reduceOnly: params.reduceOnly ?? false,
        raw: response,
      },
    };
  }

  finish(context: FinishContext): void {
    const intent = context.intent as PerpPlaceOrderIntent;
    this.activityLog.logActivity({
      chain_id: intent.chainId,
      wallet_address: intent.walletAddress,
      action: 'perp:place_order',
      protocol: 'hyperliquid',
      token_a_type: intent.params.collateralCoinType,
      token_a_amount: intent.params.quantityE9,
      token_b_type: intent.params.marketCoinType,
      value_usd: intent.valueUsd ?? undefined,
      tx_digest: context.txDigest ?? undefined,
      gas_cost: context.gasUsed ?? undefined,
      policy_decision: context.status,
      rejection_reason: context.rejection?.reason ?? undefined,
      rejection_check: context.rejection?.check ?? undefined,
      metadata: {
        marketSymbol: intent.params.marketSymbol,
        side: intent.params.side,
        leverage: intent.params.leverageE9,
      },
    });
  }
}

/**
 * Defensively probe for a hash / order id in the SDK response — the
 * `hyperliquid` package's placeOrder shape has shifted across releases.
 */
function safeHashFrom(response: unknown): string | undefined {
  if (typeof response !== 'object' || response === null) return undefined;
  const record = response as Record<string, unknown>;
  const candidate = record['status'] ?? record['response'] ?? record['data'] ?? record['hash'];
  if (typeof candidate === 'string') return candidate;
  return undefined;
}
