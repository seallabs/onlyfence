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
 * Root application configuration parsed from ~/.onlyfence/config.toml.
 */
export interface AppConfig {
  /** Per-chain configuration keyed by chain name */
  readonly chain: Record<Chain, ChainConfig>;

  /** Global settings (post-MVP) */
  readonly global?: GlobalConfig;

  /** Anonymous telemetry / error reporting */
  readonly telemetry?: TelemetryConfig;

  /** Automatic update settings */
  readonly update?: UpdateConfig;
}
