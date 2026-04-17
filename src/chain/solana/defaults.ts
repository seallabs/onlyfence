import type { AllowlistConfig, ChainConfig, LimitsConfig, PerpConfig } from '../../types/config.js';

/** Default Solana mainnet RPC endpoint. */
export const SOLANA_MAINNET_RPC = 'https://api.mainnet-beta.solana.com';

/** Default allowlist for Solana chain. */
export const DEFAULT_SOLANA_ALLOWLIST: AllowlistConfig = {
  tokens: ['SOL', 'USDC', 'USDT', 'JitoSOL', 'JupSOL'],
};

/** Default spending limits for Solana chain. */
export const DEFAULT_SOLANA_LIMITS: LimitsConfig = {
  max_single_trade: 200,
  max_24h_volume: 500,
};

/** Default perp guardrails for Solana chain. */
export const DEFAULT_SOLANA_PERP: PerpConfig = {
  allowlist_markets: ['SOL-USD', 'ETH-USD', 'BTC-USD'],
  max_leverage: 10,
  max_single_order: 5000,
  max_24h_volume: 50000,
  max_24h_withdraw: 5000,
};

/** Default chain configuration for Solana. */
export const DEFAULT_SOLANA_CHAIN_CONFIG: ChainConfig = {
  rpc: SOLANA_MAINNET_RPC,
  allowlist: DEFAULT_SOLANA_ALLOWLIST,
  limits: DEFAULT_SOLANA_LIMITS,
  perp: DEFAULT_SOLANA_PERP,
};
