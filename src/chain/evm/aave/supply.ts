import type { EthereumTransactionTypeExtended } from '@aave/contract-helpers';
import type { SupplyIntent } from '../../../core/action-types.js';
import { AaveLendBuilderBase } from './base.js';

/** Aave V3 supply builder — deposits an ERC-20 reserve into the pool. */
export class AaveLendSupplyBuilder extends AaveLendBuilderBase<SupplyIntent> {
  readonly builderId = 'aave-v3-supply';
  protected readonly activityAction = 'lending:supply' as const;
  protected readonly aaveAction = 'supply';

  protected callPool(
    intent: SupplyIntent,
    user: string,
    humanAmount: string,
  ): Promise<EthereumTransactionTypeExtended[]> {
    return this.pool.supply({
      user,
      reserve: intent.params.coinType,
      amount: humanAmount,
      onBehalfOf: user,
    });
  }
}
