import type { ChainRegistry } from '../chain/registry.js';
import { SUI_DEFAULT_CHAIN_CONFIG } from '../chain/sui/defaults.js';
import type {
  AllowlistConfig,
  AppConfig,
  ChainConfig,
  GlobalConfig,
  LimitsConfig,
  SecurityConfig,
  TelemetryConfig,
  UpdateConfig,
} from '../types/config.js';

/**
 * Error thrown when attempting to create a config that already exists.
 */
export class ConfigAlreadyExistsError extends Error {
  constructor(configPath: string) {
    super(`Configuration file already exists at "${configPath}". ` + `Use --force to overwrite.`);
    this.name = 'ConfigAlreadyExistsError';
  }
}

/**
 * Errors thrown during config validation.
 */
export class ConfigValidationError extends Error {
  readonly path: string;

  constructor(message: string, path: string) {
    super(`Config validation error at "${path}": ${message}`);
    this.name = 'ConfigValidationError';
    this.path = path;
  }
}

/**
 * Type guard: asserts value is a non-null object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Default upper bounds for spending limits.
 * These prevent a compromised config from setting limits to infinity.
 */
export const DEFAULT_MAX_SINGLE_TRADE_CEILING = 10_000;
export const DEFAULT_MAX_24H_VOLUME_CEILING = 100_000;

/** Upper bounds passed through validation to cap per-chain limits. */
interface LimitCeilings {
  readonly tradeCeiling: number;
  readonly volumeCeiling: number;
}

/**
 * Returns a default AppConfig suitable for first-time setup.
 *
 * When called with no arguments, defaults to Sui-only for backwards compatibility.
 * When called with explicit chains and a registry, builds config from chain definitions.
 *
 * @param chains - Chain names to include (defaults to ['sui'])
 * @param registry - ChainRegistry to look up default configs from
 */
export function createDefaultConfig(
  chains?: readonly string[],
  registry?: ChainRegistry,
): AppConfig {
  const selected = chains ?? ['sui'];
  const chainConfigs: Record<string, ChainConfig> = {};

  for (const name of selected) {
    if (registry?.has(name) === true) {
      chainConfigs[name] = registry.get(name).defaultConfig;
    } else if (name === 'sui') {
      // Fallback for backwards compatibility when called without registry
      chainConfigs[name] = SUI_DEFAULT_CHAIN_CONFIG;
    } else {
      throw new Error(
        `Cannot create default config for unknown chain "${name}". ` +
          (registry !== undefined
            ? `Available: ${registry.names().join(', ')}`
            : 'No chain registry provided.'),
      );
    }
  }

  return { chain: chainConfigs };
}

/**
 * Validate a parsed TOML object against the AppConfig schema.
 *
 * @param raw - Raw parsed TOML data
 * @returns Validated AppConfig
 * @throws ConfigValidationError if validation fails
 */
export function validateConfig(raw: unknown): AppConfig {
  if (!isRecord(raw)) {
    throw new ConfigValidationError('Config must be an object', 'root');
  }

  // Validate security section first so we can use ceilings for limit validation
  const security = raw['security'];
  if (security !== undefined && !isRecord(security)) {
    throw new ConfigValidationError('"security" must be an object if present', 'security');
  }
  const validatedSecurity = security !== undefined ? validateSecurityConfig(security) : undefined;

  const ceilings: LimitCeilings = {
    tradeCeiling: validatedSecurity?.max_single_trade_ceiling ?? DEFAULT_MAX_SINGLE_TRADE_CEILING,
    volumeCeiling: validatedSecurity?.max_24h_volume_ceiling ?? DEFAULT_MAX_24H_VOLUME_CEILING,
  };

  if (!isRecord(raw['chain'])) {
    throw new ConfigValidationError('Missing or invalid "chain" section', 'chain');
  }

  const chainSection = raw['chain'];
  const validatedChains: Record<string, ChainConfig> = {};

  for (const [chainName, chainValue] of Object.entries(chainSection)) {
    validatedChains[chainName] = validateChainConfig(chainValue, `chain.${chainName}`, ceilings);
  }

  const global = raw['global'];
  if (global !== undefined && !isRecord(global)) {
    throw new ConfigValidationError('"global" must be an object if present', 'global');
  }

  const telemetry = raw['telemetry'];
  if (telemetry !== undefined && !isRecord(telemetry)) {
    throw new ConfigValidationError('"telemetry" must be an object if present', 'telemetry');
  }

  const update = raw['update'];
  if (update !== undefined && !isRecord(update)) {
    throw new ConfigValidationError('"update" must be an object if present', 'update');
  }

  return {
    chain: validatedChains,
    ...(global !== undefined ? { global: validateGlobalConfig(global) } : {}),
    ...(telemetry !== undefined ? { telemetry: validateTelemetryConfig(telemetry) } : {}),
    ...(update !== undefined ? { update: validateUpdateConfig(update) } : {}),
    ...(validatedSecurity !== undefined ? { security: validatedSecurity } : {}),
  };
}

function validateChainConfig(raw: unknown, path: string, ceilings: LimitCeilings): ChainConfig {
  if (!isRecord(raw)) {
    throw new ConfigValidationError('Chain config must be an object', path);
  }

  if (typeof raw['rpc'] !== 'string' || raw['rpc'].length === 0) {
    throw new ConfigValidationError('Missing or empty "rpc" field', `${path}.rpc`);
  }

  return {
    rpc: raw['rpc'],
    ...(raw['allowlist'] !== undefined
      ? { allowlist: validateAllowlist(raw['allowlist'], `${path}.allowlist`) }
      : {}),
    ...(raw['limits'] !== undefined
      ? { limits: validateLimits(raw['limits'], `${path}.limits`, ceilings) }
      : {}),
  };
}

function validateAllowlist(raw: unknown, path: string): AllowlistConfig {
  if (!isRecord(raw)) {
    throw new ConfigValidationError('Allowlist must be an object', path);
  }

  if (!Array.isArray(raw['tokens'])) {
    throw new ConfigValidationError('"tokens" must be an array', `${path}.tokens`);
  }

  const tokens: string[] = [];
  for (const token of raw['tokens']) {
    if (typeof token !== 'string') {
      throw new ConfigValidationError('Each token must be a string', `${path}.tokens`);
    }
    tokens.push(token);
  }

  return { tokens };
}

function validateGlobalConfig(raw: Record<string, unknown>): GlobalConfig {
  const vol = raw['max_24h_volume_all_chains'];
  if (vol !== undefined && (typeof vol !== 'number' || vol <= 0)) {
    throw new ConfigValidationError(
      '"max_24h_volume_all_chains" must be a positive number if present',
      'global.max_24h_volume_all_chains',
    );
  }

  return {
    ...(vol !== undefined ? { max_24h_volume_all_chains: vol } : {}),
  };
}

function validateTelemetryConfig(raw: Record<string, unknown>): TelemetryConfig {
  const enabled = raw['enabled'];
  if (typeof enabled !== 'boolean') {
    throw new ConfigValidationError('"enabled" must be a boolean', 'telemetry.enabled');
  }

  return { enabled };
}

function validateUpdateConfig(raw: Record<string, unknown>): UpdateConfig {
  const autoInstall = raw['auto_install'];
  if (typeof autoInstall !== 'boolean') {
    throw new ConfigValidationError('"auto_install" must be a boolean', 'update.auto_install');
  }

  return { auto_install: autoInstall };
}

function validateLimits(
  raw: unknown,
  path: string,
  { tradeCeiling, volumeCeiling }: LimitCeilings,
): LimitsConfig {
  if (!isRecord(raw)) {
    throw new ConfigValidationError('Limits must be an object', path);
  }

  if (typeof raw['max_single_trade'] !== 'number' || raw['max_single_trade'] <= 0) {
    throw new ConfigValidationError(
      '"max_single_trade" must be a positive number',
      `${path}.max_single_trade`,
    );
  }

  if (raw['max_single_trade'] > tradeCeiling) {
    throw new ConfigValidationError(
      `"max_single_trade" (${String(raw['max_single_trade'])}) exceeds the safety ceiling of ${String(tradeCeiling)}. ` +
        `To raise the ceiling, set security.max_single_trade_ceiling in config.toml.`,
      `${path}.max_single_trade`,
    );
  }

  if (typeof raw['max_24h_volume'] !== 'number' || raw['max_24h_volume'] <= 0) {
    throw new ConfigValidationError(
      '"max_24h_volume" must be a positive number',
      `${path}.max_24h_volume`,
    );
  }

  if (raw['max_24h_volume'] > volumeCeiling) {
    throw new ConfigValidationError(
      `"max_24h_volume" (${String(raw['max_24h_volume'])}) exceeds the safety ceiling of ${String(volumeCeiling)}. ` +
        `To raise the ceiling, set security.max_24h_volume_ceiling in config.toml.`,
      `${path}.max_24h_volume`,
    );
  }

  return {
    max_single_trade: raw['max_single_trade'],
    max_24h_volume: raw['max_24h_volume'],
  };
}

function validateSecurityConfig(raw: Record<string, unknown>): SecurityConfig {
  const tradeCeiling = raw['max_single_trade_ceiling'];
  if (tradeCeiling !== undefined && (typeof tradeCeiling !== 'number' || tradeCeiling <= 0)) {
    throw new ConfigValidationError(
      '"max_single_trade_ceiling" must be a positive number if present',
      'security.max_single_trade_ceiling',
    );
  }

  const volumeCeiling = raw['max_24h_volume_ceiling'];
  if (volumeCeiling !== undefined && (typeof volumeCeiling !== 'number' || volumeCeiling <= 0)) {
    throw new ConfigValidationError(
      '"max_24h_volume_ceiling" must be a positive number if present',
      'security.max_24h_volume_ceiling',
    );
  }

  return {
    ...(tradeCeiling !== undefined ? { max_single_trade_ceiling: tradeCeiling } : {}),
    ...(volumeCeiling !== undefined ? { max_24h_volume_ceiling: volumeCeiling } : {}),
  };
}
