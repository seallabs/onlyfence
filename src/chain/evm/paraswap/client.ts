import { constructSimpleSDK, type SimpleFetchSDK } from '@paraswap/sdk';
import { ETHEREUM_CHAIN_ID } from '../defaults.js';

/**
 * Thin wrapper around `@paraswap/sdk`'s fetch-only SDK builder so the
 * chain module can memoize a single instance and callers can later
 * attach retry / metrics / fee-collection without touching every builder.
 */
export class ParaswapClient {
  private readonly sdk: SimpleFetchSDK;

  constructor(chainId: number = ETHEREUM_CHAIN_ID) {
    this.sdk = constructSimpleSDK({ chainId, fetch });
  }

  get swap(): SimpleFetchSDK['swap'] {
    return this.sdk.swap;
  }
}
