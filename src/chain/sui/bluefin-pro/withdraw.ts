import type {
  ActionBuilder,
  BuiltTransaction,
  FinishContext,
} from '../../../core/action-builder.js';
import type { PerpWithdrawIntent } from '../../../core/action-types.js';
import type { ActivityLog } from '../../../db/activity-log.js';
import type { BluefinClient } from './client.js';
import { bluefinActivityBase } from './types.js';

export class BluefinWithdrawBuilder implements ActionBuilder<PerpWithdrawIntent> {
  readonly builderId = 'bluefin-pro-withdraw';
  readonly chain = 'sui';
  readonly executionStrategy = 'off-chain-signed' as const;

  constructor(
    private readonly client: BluefinClient,
    private readonly activityLog: ActivityLog,
  ) {}

  validate(intent: PerpWithdrawIntent): void {
    if (intent.params.amountE9 === '0') {
      throw new Error('amount must be greater than zero');
    }
    if (intent.params.assetSymbol === '') {
      throw new Error('assetSymbol is required');
    }
  }

  build(_intent: PerpWithdrawIntent): Promise<BuiltTransaction> {
    return Promise.resolve({ transaction: null, metadata: {} });
  }

  async execute(intent: PerpWithdrawIntent): Promise<{ metadata: Record<string, unknown> }> {
    const { params } = intent;

    await this.client.withdraw(params.assetSymbol, params.amountE9);

    return {
      metadata: {
        assetSymbol: params.assetSymbol,
        amountE9: params.amountE9,
      },
    };
  }

  finish(context: FinishContext): void {
    const intent = context.intent as PerpWithdrawIntent;
    this.activityLog.logActivity({
      ...bluefinActivityBase(intent, 'perp:withdraw', context),
      ...(intent.valueUsd !== undefined ? { value_usd: intent.valueUsd } : {}),
    });
  }
}
