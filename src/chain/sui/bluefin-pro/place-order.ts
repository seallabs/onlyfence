import BigNumber from 'bignumber.js';
import { v4 as uuid } from 'uuid';
import type {
  ActionBuilder,
  BuiltTransaction,
  FinishContext,
} from '../../../core/action-builder.js';
import type { PerpPlaceOrderIntent } from '../../../core/action-types.js';
import type { PerpMarketInfo } from '../../../core/perp-provider.js';
import type { ActivityLog } from '../../../db/activity-log.js';
import type { BluefinClient } from './client.js';
import { fetchBluefinMarkets } from './markets.js';
import { fromE9, bluefinActivityBase } from './types.js';

/** Default order expiry: 30 days in milliseconds. */
const ORDER_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

export class BluefinPlaceOrderBuilder implements ActionBuilder<PerpPlaceOrderIntent> {
  readonly builderId = 'bluefin-pro-place-order';
  readonly chain = 'sui';
  readonly executionStrategy = 'off-chain-signed' as const;

  constructor(
    private readonly client: BluefinClient,
    private readonly activityLog: ActivityLog,
  ) {}

  validate(intent: PerpPlaceOrderIntent): void {
    if (intent.params.marketSymbol === '') {
      throw new Error('marketSymbol is required');
    }
    if (intent.params.quantityE9 === '0') {
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
    const { params } = intent;

    // Fetch market info for validation.
    const markets = await fetchBluefinMarkets(this.client);
    const market = markets.find((m) => m.symbol === params.marketSymbol);
    if (market === undefined) {
      throw new Error(`Unknown market "${params.marketSymbol}"`);
    }

    // ── Validate against market constraints ──────────────────────────────
    const leverageE9 = this.validateAndResolveLeverage(params, market);
    const priceE9 = params.orderType === 'MARKET' ? '0' : (params.limitPriceE9 ?? '0');

    this.validateQuantity(params.quantityE9, market);
    if (params.orderType === 'LIMIT') {
      this.validatePrice(priceE9, market);
    }
    const clientOrderId = uuid();

    // WS connects first, then onReady places the order — ensures we never miss
    // fast rejection events.
    const confirmation = await this.client.waitForOrderEvent(
      clientOrderId,
      async () => {
        await this.client.createOrder({
          clientOrderId,
          type: params.orderType,
          symbol: params.marketSymbol,
          priceE9,
          quantityE9: params.quantityE9,
          side: params.side,
          leverageE9,
          isIsolated: false,
          expiresAtMillis: Date.now() + ORDER_EXPIRY_MS,
          reduceOnly: params.reduceOnly ?? false,
          timeInForce: params.timeInForce ?? 'GTT',
        });
      },
      10_000,
    );

    const timeInForce = params.timeInForce ?? 'GTT';
    const isIocFok = timeInForce === 'IOC' || timeInForce === 'FOK';

    const baseMetadata = {
      marketSymbol: params.marketSymbol,
      side: params.side,
      orderType: params.orderType,
      quantityE9: params.quantityE9,
      priceE9,
      leverageE9,
      reduceOnly: params.reduceOnly ?? false,
      timeInForce,
    };

    function iocFokResult(
      note: string,
      orderHash: string | undefined,
    ): { metadata: Record<string, unknown> } {
      return {
        metadata: {
          ...baseMetadata,
          ...(orderHash !== undefined ? { orderHash } : {}),
          note,
        },
      };
    }

    // IOC/FOK orders with no counterparty match get INSUFFICIENT_LIQUIDITY
    // from the exchange — this is expected behavior, not a real rejection.
    if (confirmation.status === 'rejected') {
      if (isIocFok && confirmation.reason === 'INSUFFICIENT_LIQUIDITY') {
        return iocFokResult(
          'IOC/FOK order processed. No counterparty match.',
          confirmation.orderHash,
        );
      }
      throw new Error(`Order rejected by exchange: ${confirmation.reason ?? 'unknown reason'}`);
    }

    // The WS may report OPEN before the exchange async-cancels (e.g.
    // insufficient margin). Verify via HTTP that the order actually exists.
    const orders = await this.client.getOpenOrders(params.marketSymbol);
    const found = orders.find((o) => o.clientOrderId === clientOrderId);

    if (found !== undefined) {
      return { metadata: { ...baseMetadata, orderHash: found.orderHash } };
    }

    // IOC/FOK orders are expected to not appear in open orders — they
    // execute immediately or cancel. If the WS confirmed it, treat as
    // acknowledged (the fill will show up in trade history).
    if (isIocFok) {
      return iocFokResult(
        'IOC/FOK order processed. Check trade history for fill status.',
        confirmation.orderHash,
      );
    }

    throw new Error('Order rejected by exchange: order not found after placement');
  }

  // ── Market constraint validation helpers ──────────────────────────────

  private validateAndResolveLeverage(
    params: PerpPlaceOrderIntent['params'],
    market: PerpMarketInfo,
  ): string {
    if (params.leverageE9 !== undefined) {
      const requested = fromE9(params.leverageE9);
      const max = fromE9(market.maxLeverageE9);
      if (requested <= 0) {
        throw new Error('Leverage must be greater than zero');
      }
      if (requested > max) {
        throw new Error(
          `Leverage ${requested}x exceeds maximum ${max}x for ${params.marketSymbol}`,
        );
      }
      return params.leverageE9;
    }
    return market.defaultLeverageE9;
  }

  private validateQuantity(quantityE9: string, market: PerpMarketInfo): void {
    const qty = new BigNumber(quantityE9);
    const min = new BigNumber(market.minOrderSizeE9);
    const max = new BigNumber(market.maxOrderSizeE9);
    const step = new BigNumber(market.stepSizeE9);

    if (qty.lt(min)) {
      throw new Error(
        `Quantity ${fromE9(quantityE9)} is below minimum ${fromE9(market.minOrderSizeE9)} for ${market.symbol}`,
      );
    }
    if (qty.gt(max)) {
      throw new Error(
        `Quantity ${fromE9(quantityE9)} exceeds maximum ${fromE9(market.maxOrderSizeE9)} for ${market.symbol}`,
      );
    }
    if (!qty.mod(step).isZero()) {
      throw new Error(
        `Quantity ${fromE9(quantityE9)} is not a multiple of step size ${fromE9(market.stepSizeE9)} for ${market.symbol}`,
      );
    }
  }

  private validatePrice(priceE9: string, market: PerpMarketInfo): void {
    const price = new BigNumber(priceE9);
    const tick = new BigNumber(market.tickSizeE9);

    if (price.lte(0)) {
      throw new Error('Limit price must be greater than zero');
    }
    if (!price.mod(tick).isZero()) {
      throw new Error(
        `Price ${fromE9(priceE9)} is not a multiple of tick size ${fromE9(market.tickSizeE9)} for ${market.symbol}`,
      );
    }
  }

  finish(context: FinishContext): void {
    const intent = context.intent as PerpPlaceOrderIntent;
    this.activityLog.logActivity({
      ...bluefinActivityBase(intent, 'perp:place_order', context),
      token_a_type: intent.params.collateralCoinType,
      token_b_type: intent.params.marketCoinType,
      ...(intent.valueUsd !== undefined ? { value_usd: intent.valueUsd } : {}),
    });
  }
}
