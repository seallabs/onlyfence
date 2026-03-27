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
import { bluefinActivityBase, fromE9 } from './types.js';

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
    const leverageE9 = await this.validateAndResolveLeverage(params, market);
    // Market orders use price = 0
    const priceE9 = params.orderType === 'MARKET' ? '0' : (params.limitPriceE9 ?? '0');

    this.validateQuantity(params.quantityE9, market);
    if (params.orderType === 'LIMIT') {
      this.validatePrice(priceE9, market);
    }
    const clientOrderId = uuid();

    return this.executeWithConfirmation(clientOrderId, params, priceE9, leverageE9);
  }

  /**
   * Unified execution with WS confirmation for all order types.
   */
  private async executeWithConfirmation(
    clientOrderId: string,
    params: PerpPlaceOrderIntent['params'],
    priceE9: string,
    leverageE9: string,
  ): Promise<{ metadata: Record<string, unknown> }> {
    // TIF only apply for LIMIT orders
    const wireTif = params.orderType === 'MARKET' ? undefined : (params.timeInForce ?? 'GTT');

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
          timeInForce: wireTif,
        });
      },
      10_000,
    );

    const baseMetadata = this.buildBaseMetadata(params, priceE9, leverageE9);

    // Rejected: throw with the exchange reason.
    // IOC/FOK with INSUFFICIENT_LIQUIDITY is expected (no counterparty match).
    if (confirmation.status === 'rejected') {
      const isIocFok = wireTif === 'IOC' || wireTif === 'FOK';
      if (isIocFok && confirmation.reason === 'INSUFFICIENT_LIQUIDITY') {
        return {
          metadata: {
            ...baseMetadata,
            ...(confirmation.orderHash !== undefined ? { orderHash: confirmation.orderHash } : {}),
            note: 'IOC/FOK order processed. No counterparty match.',
          },
        };
      }
      throw new Error(`Order rejected by exchange: ${confirmation.reason ?? 'unknown reason'}`);
    }

    // Confirmed or timeout: trust the WS result.
    // No HTTP poll needed — the WS already told us the outcome.
    // Orders may be OPEN, FILLED, or any confirmed state.
    return {
      metadata: {
        ...baseMetadata,
        ...(confirmation.orderHash !== undefined ? { orderHash: confirmation.orderHash } : {}),
        ...(confirmation.status === 'timeout'
          ? {
              _pipelineStatus: 'acknowledged' as const,
              note: 'Order submitted but WS confirmation timed out. Verify with: fence perp orders',
            }
          : {}),
      },
    };
  }

  private buildBaseMetadata(
    params: PerpPlaceOrderIntent['params'],
    priceE9: string,
    leverageE9: string,
  ): Record<string, unknown> {
    return {
      marketSymbol: params.marketSymbol,
      side: params.side,
      orderType: params.orderType,
      quantityE9: params.quantityE9,
      priceE9,
      leverageE9,
      reduceOnly: params.reduceOnly ?? false,
      timeInForce: params.orderType === 'MARKET' ? undefined : (params.timeInForce ?? 'GTT'),
    };
  }

  // ── Market constraint validation helpers ──────────────────────────────

  private async validateAndResolveLeverage(
    params: PerpPlaceOrderIntent['params'],
    market: PerpMarketInfo,
  ): Promise<string> {
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

    // Auto-resolve from existing position if available
    const account = await this.client.getAccountDetails();
    const position = account.positions.find((p) => p.symbol === params.marketSymbol);
    if (position !== undefined) {
      return position.clientSetLeverageE9;
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
