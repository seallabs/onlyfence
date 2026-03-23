import type { AlphalendClient } from '@alphafi/alphalend-sdk';
import { getUserPositionCapId } from '@alphafi/alphalend-sdk';
import type { SuiClient } from '@mysten/sui/client';
import type {
  ActionBuilder,
  BuiltTransaction,
  FinishContext,
} from '../../../core/action-builder.js';
import type { ClaimRewardsIntent } from '../../../core/action-types.js';
import type { ActivityLog } from '../../../db/activity-log.js';
import type { SuiRawResponse } from '../types.js';
import { finishLendingActivity } from './base.js';

/**
 * AlphaLend claim rewards builder for Sui.
 * Implements ActionBuilder for the "claim_rewards" action.
 *
 * Fetches the user's position cap ID, then calls the AlphaLend SDK
 * claimRewards method with both deposit flags set to false (withdraw
 * rewards to wallet rather than re-depositing).
 */
export class AlphaLendClaimRewardsBuilder implements ActionBuilder<
  ClaimRewardsIntent,
  SuiRawResponse
> {
  readonly builderId = 'alphalend-claim-rewards';
  readonly chain = 'sui';

  constructor(
    private readonly alphalendClient: AlphalendClient,
    private readonly suiClient: SuiClient,
    private readonly activityLog: ActivityLog,
  ) {}

  validate(_intent: ClaimRewardsIntent): void {
    // No params to validate beyond protocol, which is already resolved
  }

  async build(intent: ClaimRewardsIntent): Promise<BuiltTransaction> {
    const network = intent.chainId.split(':')[1] ?? 'mainnet';
    const positionCapId = await getUserPositionCapId(this.suiClient, network, intent.walletAddress);
    if (positionCapId === undefined) {
      throw new Error('No position found. Supply collateral first.');
    }

    // eslint-disable-next-line @typescript-eslint/no-deprecated -- SDK marks this as deprecated but provides no replacement
    const transaction = await this.alphalendClient.claimRewards({
      positionCapId,
      address: intent.walletAddress,
      claimAndDepositAlpha: false,
      claimAndDepositAll: false,
    });
    transaction.setSenderIfNotSet(intent.walletAddress);

    return {
      transaction,
      metadata: {
        action: 'claim_rewards',
        protocol: 'alphalend',
      },
    };
  }

  finish(context: FinishContext<SuiRawResponse>): void {
    finishLendingActivity(context, 'lending:claim_rewards', this.activityLog);
  }
}
