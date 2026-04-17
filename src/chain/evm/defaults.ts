import type { AllowlistConfig, ChainConfig, LimitsConfig, PerpConfig } from '../../types/config.js';

/** Default Ethereum mainnet public RPC. */
export const EVM_MAINNET_RPC = 'https://eth.api.onfinality.io/public';

/** EIP-155 chain id for Ethereum mainnet. */
export const ETHEREUM_CHAIN_ID = 1;

export const DEFAULT_EVM_ALLOWLIST: AllowlistConfig = {
  tokens: ['ETH', 'WETH', 'USDC', 'USDT', 'DAI', 'WBTC'],
};

export const DEFAULT_EVM_LIMITS: LimitsConfig = {
  max_single_trade: 500,
  max_24h_volume: 2000,
};

export const DEFAULT_EVM_PERP: PerpConfig = {
  allowlist_markets: ['ETH-USD', 'BTC-USD', 'SOL-USD'],
  max_leverage: 5,
  max_single_order: 5000,
  max_24h_volume: 50000,
  max_24h_withdraw: 5000,
};

export const DEFAULT_EVM_CHAIN_CONFIG: ChainConfig = {
  rpc: EVM_MAINNET_RPC,
  allowlist: DEFAULT_EVM_ALLOWLIST,
  limits: DEFAULT_EVM_LIMITS,
  perp: DEFAULT_EVM_PERP,
};
