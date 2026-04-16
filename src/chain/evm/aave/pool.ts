import { Pool } from '@aave/contract-helpers';
import type { providers } from 'ethers';

/**
 * Create an Aave V3 `Pool` service bound to the supplied ethers v5
 * provider. Omitting the market config makes the service read its
 * contract addresses from its internal Ethereum mainnet defaults.
 */
export function createAavePool(provider: providers.Provider): Pool {
  return new Pool(provider);
}
