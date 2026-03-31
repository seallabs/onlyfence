import type { Chain, ChainId } from '../core/action-types.js';
import type { ChainAdapterFactory } from '../chain/factory.js';
import type { AppConfig } from '../types/config.js';

/**
 * Resolve the default chain from config.
 *
 * Priority: config.default_chain > first configured chain.
 * Throws if no chains are configured.
 *
 * @param config - Application configuration
 * @returns The default chain identifier
 * @throws Error if no chains are configured
 */
export function resolveDefaultChain(config: AppConfig): Chain {
  if (config.default_chain !== undefined) {
    return config.default_chain;
  }
  const chains = Object.keys(config.chain);
  if (chains.length === 0) {
    throw new Error('No chains configured. Run "fence setup" to configure a chain.');
  }
  return chains[0] as Chain;
}

/**
 * Resolve the CAIP-2 ChainId for a given chain via the adapter factory.
 *
 * @param chain - Chain name (e.g., "sui")
 * @param factory - Chain adapter factory with registered adapters
 * @returns CAIP-2 chain identifier (e.g., "sui:mainnet")
 */
export function resolveChainId(chain: string, factory: ChainAdapterFactory): ChainId {
  return factory.get(chain).chainId;
}
