import { v4 as uuid } from 'uuid';
import type {
  ActionBuilder,
  BuiltTransaction,
  FinishContext,
} from '../../../core/action-builder.js';
import type { PerpPlaceOrderIntent } from '../../../core/action-types.js';
import type { ActivityLog } from '../../../db/activity-log.js';
import type { BluefinClient } from './client.js';
import { bluefinActivityBase } from './types.js';

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

    await this.client.updateLeverage(params.marketSymbol, params.leverageE9);

    const priceE9 = params.orderType === 'MARKET' ? '0' : (params.limitPriceE9 ?? '0');
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
          leverageE9: params.leverageE9,
          isIsolated: false,
          expiresAtMillis: Date.now() + 30 * 24 * 60 * 60 * 1000,
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
      leverageE9: params.leverageE9,
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
