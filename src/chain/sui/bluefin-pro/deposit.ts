import type {
  ActionBuilder,
  BuiltTransaction,
  FinishContext,
} from '../../../core/action-builder.js';
import type { PerpDepositIntent } from '../../../core/action-types.js';
import type { ActivityLog } from '../../../db/activity-log.js';
import type { BluefinClient } from './client.js';
import { bluefinActivityBase, nativeToE9 } from './types.js';

/**
 * Deposit USDC into the Bluefin margin bank.
 *
 * Although this is an on-chain TX, the Bluefin SDK handles building,
 * signing, and submitting internally via sdk.deposit(). We use the
 * off-chain-signed strategy so the pipeline delegates to execute().
 */
export class BluefinDepositBuilder implements ActionBuilder<PerpDepositIntent> {
  readonly builderId = 'bluefin-pro-deposit';
  readonly chain = 'sui';
  readonly executionStrategy = 'off-chain-signed' as const;

  constructor(
    private readonly client: BluefinClient,
    private readonly activityLog: ActivityLog,
  ) {}

  validate(intent: PerpDepositIntent): void {
    if (intent.params.coinType === '') {
      throw new Error('coinType is required');
    }
    if (intent.params.amount === '0') {
      throw new Error('amount must be greater than zero');
    }
  }

  build(_intent: PerpDepositIntent): Promise<BuiltTransaction> {
    return Promise.resolve({ transaction: null, metadata: {} });
  }

  async execute(intent: PerpDepositIntent): Promise<{ metadata: Record<string, unknown> }> {
    const amountE9 = nativeToE9(intent.params.amount, intent.params.decimals);
    // SDK deposit() expects native token units (e.g. 1e6 for 1 USDC) despite
    // the internal parameter being named "amountE9". amountE9 is only used for
    // metadata — the actual SDK call receives native-scaled amount.
    const result = await this.client.deposit(intent.params.amount);
    const txDigest = result.effects?.transactionDigest;

    return {
      metadata: {
        coinType: intent.params.coinType,
        amount: intent.params.amount,
        amountE9,
        ...(txDigest !== undefined ? { txDigest } : {}),
      },
    };
  }

  finish(context: FinishContext): void {
    const intent = context.intent as PerpDepositIntent;
    this.activityLog.logActivity({
      ...bluefinActivityBase(intent, 'perp:deposit', context),
      token_a_type: intent.params.coinType,
      token_a_amount: intent.params.amount,
      ...(intent.valueUsd !== undefined ? { value_usd: intent.valueUsd } : {}),
    });
  }
}
