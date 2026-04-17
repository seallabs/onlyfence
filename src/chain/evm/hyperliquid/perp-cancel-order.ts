import type {
  ActionBuilder,
  BuiltTransaction,
  FinishContext,
} from '../../../core/action-builder.js';
import type { PerpCancelOrderIntent } from '../../../core/action-types.js';
import type { ActivityLog } from '../../../db/activity-log.js';
import type { HyperliquidClient } from './client.js';

/**
 * Hyperliquid perp cancel-order builder. Always forwards cancels as an
 * array so batch cancels use a single signature / REST call.
 */
export class HyperliquidCancelOrderBuilder implements ActionBuilder<PerpCancelOrderIntent> {
  readonly builderId = 'hyperliquid-cancel-order';
  readonly chain = 'ethereum';
  readonly executionStrategy = 'off-chain-signed' as const;

  constructor(
    private readonly getClient: () => HyperliquidClient,
    private readonly activityLog: ActivityLog,
  ) {}

  validate(intent: PerpCancelOrderIntent): void {
    if (intent.params.marketSymbol === '') {
      throw new Error('marketSymbol is required');
    }
    if (intent.params.orderHashes === undefined || intent.params.orderHashes.length === 0) {
      throw new Error('orderHashes is required for Hyperliquid cancel');
    }
  }

  build(_intent: PerpCancelOrderIntent): Promise<BuiltTransaction> {
    return Promise.resolve({ transaction: null, metadata: {} });
  }

  async execute(intent: PerpCancelOrderIntent): Promise<{ metadata: Record<string, unknown> }> {
    const client = this.getClient();
    const coin = intent.params.marketSymbol.split('-')[0] ?? intent.params.marketSymbol;
    const orderHashes = intent.params.orderHashes ?? [];

    // Hyperliquid identifies orders by their numeric exchange-side `oid`.
    // OnlyFence's protocol-agnostic intent carries them as strings.
    const requests = orderHashes.map((raw) => {
      const oid = Number.parseInt(raw, 10);
      if (!Number.isFinite(oid)) {
        throw new Error(`Invalid Hyperliquid order id "${raw}" — expected a numeric oid.`);
      }
      return { coin, o: oid };
    });

    const response = await client.sdk.exchange.cancelOrder(requests);

    return {
      metadata: {
        canceled: requests.length,
        orderHashes,
        raw: response,
      },
    };
  }

  finish(context: FinishContext): void {
    const intent = context.intent as PerpCancelOrderIntent;
    this.activityLog.logActivity({
      chain_id: intent.chainId,
      wallet_address: intent.walletAddress,
      action: 'perp:cancel_order',
      protocol: 'hyperliquid',
      policy_decision: context.status,
      rejection_reason: context.rejection?.reason ?? undefined,
      rejection_check: context.rejection?.check ?? undefined,
      metadata: {
        marketSymbol: intent.params.marketSymbol,
        orderHashes: intent.params.orderHashes,
      },
    });
  }
}
