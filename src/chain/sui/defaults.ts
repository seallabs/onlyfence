import type { AllowlistConfig, ChainConfig, LimitsConfig } from '../../types/config.js';

/** Default allowlist for Sui chain (MVP tokens). */
export const SUI_DEFAULT_ALLOWLIST: AllowlistConfig = {
  tokens: ['SUI', 'USDC', 'USDT', 'DEEP', 'BLUE', 'WAL'],
};

/** Default spending limits for Sui chain. */
export const SUI_DEFAULT_LIMITS: LimitsConfig = {
  max_single_trade: 200,
  max_24h_volume: 500,
};

/** Default chain configuration for Sui. */
export const SUI_DEFAULT_CHAIN_CONFIG: ChainConfig = {
  rpc: 'https://fullnode.mainnet.sui.io:443',
  allowlist: SUI_DEFAULT_ALLOWLIST,
  limits: SUI_DEFAULT_LIMITS,
};
