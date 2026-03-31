import type {
  ActionBuilder,
  BuiltTransaction,
  FinishContext,
} from '../../../core/action-builder.js';
import type { PerpCancelOrderIntent } from '../../../core/action-types.js';
import type { ActivityLog } from '../../../db/activity-log.js';
import type { BluefinClient } from './client.js';
import { bluefinActivityBase } from './types.js';

export class BluefinCancelOrderBuilder implements ActionBuilder<PerpCancelOrderIntent> {
  readonly builderId = 'bluefin-pro-cancel-order';
  readonly chain = 'sui';
  readonly executionStrategy = 'off-chain-signed' as const;

  constructor(
    private readonly client: BluefinClient,
    private readonly activityLog: ActivityLog,
  ) {}

  validate(intent: PerpCancelOrderIntent): void {
    if (intent.params.marketSymbol === '') {
      throw new Error('marketSymbol is required');
    }
  }

  build(_intent: PerpCancelOrderIntent): Promise<BuiltTransaction> {
    return Promise.resolve({ transaction: null, metadata: {} });
  }

  async execute(intent: PerpCancelOrderIntent): Promise<{ metadata: Record<string, unknown> }> {
    const { params } = intent;

    const orderHashes =
      params.orderHashes !== undefined && params.orderHashes.length > 0
        ? [...params.orderHashes]
        : undefined;

    // For cancel-all, snapshot open orders first so we can report the count.
    let cancelledCount: number;
    if (orderHashes === undefined) {
      const openOrders = await this.client.getOpenOrders(params.marketSymbol);
      cancelledCount = openOrders.length;
    } else {
      cancelledCount = orderHashes.length;
    }

    const request =
      orderHashes !== undefined
        ? { symbol: params.marketSymbol, orderHashes }
        : { symbol: params.marketSymbol };
    await this.client.cancelOrders(request);

    return {
      metadata: {
        marketSymbol: params.marketSymbol,
        orderHashes: orderHashes ?? [],
        cancelAll: orderHashes === undefined,
        cancelledCount,
      },
    };
  }

  finish(context: FinishContext): void {
    const intent = context.intent as PerpCancelOrderIntent;
    this.activityLog.logActivity(bluefinActivityBase(intent, 'perp:cancel_order', context));
  }
}
