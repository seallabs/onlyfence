import type { Chain } from '../core/action-types.js';

/**
 * Token allowlist configuration for a chain.
 * Only tokens in this list are permitted for trading.
 */
export interface AllowlistConfig {
  readonly tokens: readonly string[];
}

/**
 * Spending limit configuration for a chain.
 * Values are in USD.
 */
export interface LimitsConfig {
  /** Maximum USD value for a single trade */
  readonly max_single_trade: number;

  /** Maximum cumulative USD volume in a rolling 24-hour window */
  readonly max_24h_volume: number;
}

/**
 * Token denylist configuration (post-MVP).
 */
export interface DenylistConfig {
  readonly tokens?: readonly string[];
  readonly pools?: readonly string[];
}

/**
 * Protocol allowlist configuration (post-MVP).
 */
export interface ProtocolAllowlistConfig {
  readonly protocols: readonly string[];
}

/**
 * Perpetual futures guardrail configuration for a chain.
 * All numeric limits are in USD unless noted.
 */
export interface PerpConfig {
  readonly allowlist_markets?: readonly string[];
  readonly max_leverage?: number;
  readonly max_single_order?: number;
  readonly max_24h_volume?: number;
  readonly max_24h_withdraw?: number;
}

/**
 * Circuit breaker configuration (post-MVP).
 */
export interface CircuitBreakerConfig {
  readonly max_loss_24h: number;
  readonly max_consecutive_losses: number;
  readonly cooldown: string;
}

/**
 * Frequency limit configuration (post-MVP).
 */
export interface FrequencyLimitConfig {
  readonly max_trades_per_hour: number;
}

/**
 * Per-chain configuration including RPC endpoint and policy settings.
 */
export interface ChainConfig {
  /** RPC endpoint URL */
  readonly rpc: string;

  /** Network identifier (e.g., "mainnet", "testnet"). Defaults to "mainnet". */
  readonly network?: string;

  /** Token allowlist (MVP) */
  readonly allowlist?: AllowlistConfig;

  /** Spending limits (MVP) */
  readonly limits?: LimitsConfig;

  /** Token/pool denylist (post-MVP) */
  readonly denylist?: DenylistConfig;

  /** Protocol allowlist (post-MVP) */
  readonly protocol_allowlist?: ProtocolAllowlistConfig;

  /** Circuit breaker settings (post-MVP) */
  readonly circuit_breaker?: CircuitBreakerConfig;

  /** Frequency limit settings (post-MVP) */
  readonly frequency_limit?: FrequencyLimitConfig;

  /** Perpetual futures guardrails */
  readonly perp?: PerpConfig;
}

/**
 * Global cross-chain configuration (post-MVP).
 */
export interface GlobalConfig {
  readonly max_24h_volume_all_chains?: number;
}

/**
 * Telemetry configuration for anonymous error reporting.
 */
export interface TelemetryConfig {
  /** Whether remote error reporting is enabled. Defaults to false. */
  readonly enabled: boolean;
}

/**
 * Update configuration for automatic version checking and installation.
 */
export interface UpdateConfig {
  /** Whether to silently install updates (true) or ask the user first (false) */
  readonly auto_install: boolean;
}

/**
 * Security configuration for deployment hardening.
 *
 * Allows operators to customize upper bounds on config values.
 * If not set, hardcoded defaults apply.
 */
export interface SecurityConfig {
  /** Maximum allowed value for max_single_trade (default: 10000) */
  readonly max_single_trade_ceiling?: number;

  /** Maximum allowed value for max_24h_volume (default: 100000) */
  readonly max_24h_volume_ceiling?: number;

  /** Maximum allowed value for perp max_leverage (default: 100) */
  readonly max_perp_leverage_ceiling?: number;

  /** Maximum allowed value for perp max_single_order (default: 100000) */
  readonly max_perp_single_order_ceiling?: number;

  /** Maximum allowed value for perp max_24h_volume (default: 1000000) */
  readonly max_perp_24h_volume_ceiling?: number;

  /** Maximum allowed value for perp max_24h_withdraw (default: 100000) */
  readonly max_perp_24h_withdraw_ceiling?: number;
}

/**
 * Root application configuration parsed from ~/.onlyfence/config.toml.
 */
export interface AppConfig {
  /** Per-chain configuration keyed by chain name. Not all supported chains need to be configured. */
  readonly chain: Partial<Record<Chain, ChainConfig>>;

  /** Default chain for CLI commands when --chain is omitted. Resolved from first configured chain if absent. */
  readonly default_chain?: Chain;

  /** Global settings (post-MVP) */
  readonly global?: GlobalConfig;

  /** Anonymous telemetry / error reporting */
  readonly telemetry?: TelemetryConfig;

  /** Automatic update settings */
  readonly update?: UpdateConfig;

  /** Security hardening settings */
  readonly security?: SecurityConfig;
}
