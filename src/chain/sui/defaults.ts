import type { AllowlistConfig, ChainConfig, LimitsConfig } from '../../types/config.js';

/** Default Sui mainnet RPC endpoint. */
export const SUI_MAINNET_RPC = 'https://fullnode.mainnet.sui.io:443';

/** Default allowlist for Sui chain (MVP tokens). */
export const DEFAULT_SUI_ALLOWLIST: AllowlistConfig = {
  tokens: ['SUI', 'USDC', 'USDT', 'DEEP', 'BLUE', 'WAL'],
};

/** Default spending limits for Sui chain. */
export const DEFAULT_SUI_LIMITS: LimitsConfig = {
  max_single_trade: 200,
  max_24h_volume: 500,
};

/** Default chain configuration for Sui. */
export const DEFAULT_SUI_CHAIN_CONFIG: ChainConfig = {
  rpc: SUI_MAINNET_RPC,
  allowlist: DEFAULT_SUI_ALLOWLIST,
  limits: DEFAULT_SUI_LIMITS,
};
