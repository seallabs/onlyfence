import { Pool } from '@aave/contract-helpers';
import type { providers } from 'ethers';

/**
 * Aave V3 Ethereum mainnet contract addresses.
 * Source: https://docs.aave.com/developers/deployed-contracts/v3-mainnet/ethereum-mainnet
 * These are governance-controlled and stable — a change would require a protocol upgrade.
 */
const AAVE_V3_ETHEREUM = {
  POOL: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
  WETH_GATEWAY: '0xD322A49006FC828F9B5B37Ab215F99B4E5caB19C',
} as const;

/**
 * Create an Aave V3 `Pool` service bound to the supplied ethers v5 provider.
 * Pool and WETH Gateway addresses must be explicitly provided — the SDK does
 * not fall back to any defaults and returns an empty transaction array when
 * the pool address is unset.
 */
export function createAavePool(provider: providers.Provider): Pool {
  return new Pool(provider, {
    POOL: AAVE_V3_ETHEREUM.POOL,
    WETH_GATEWAY: AAVE_V3_ETHEREUM.WETH_GATEWAY,
  });
}
