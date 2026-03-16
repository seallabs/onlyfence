import type {
  AppConfig,
  ChainConfig,
  AllowlistConfig,
  LimitsConfig,
  GlobalConfig,
  TelemetryConfig,
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
 * Default allowlist for Sui chain (MVP tokens).
 */
const DEFAULT_SUI_ALLOWLIST: AllowlistConfig = {
  tokens: ['SUI', 'USDC', 'USDT', 'DEEP', 'BLUE', 'WAL'],
};

/**
 * Default spending limits for Sui chain.
 */
const DEFAULT_SUI_LIMITS: LimitsConfig = {
  max_single_trade: 200,
  max_24h_volume: 500,
};

/**
 * Default chain configuration for Sui.
 */
const DEFAULT_SUI_CHAIN_CONFIG: ChainConfig = {
  rpc: 'https://fullnode.mainnet.sui.io:443',
  allowlist: DEFAULT_SUI_ALLOWLIST,
  limits: DEFAULT_SUI_LIMITS,
};

/**
 * Returns a default AppConfig suitable for first-time setup.
 */
export function createDefaultConfig(): AppConfig {
  return {
    chain: {
      sui: DEFAULT_SUI_CHAIN_CONFIG,
    },
  };
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

  if (!isRecord(raw['chain'])) {
    throw new ConfigValidationError('Missing or invalid "chain" section', 'chain');
  }

  const chainSection = raw['chain'];
  const validatedChains: Record<string, ChainConfig> = {};

  for (const [chainName, chainValue] of Object.entries(chainSection)) {
    validatedChains[chainName] = validateChainConfig(chainValue, `chain.${chainName}`);
  }

  const global = raw['global'];
  if (global !== undefined && !isRecord(global)) {
    throw new ConfigValidationError('"global" must be an object if present', 'global');
  }

  const telemetry = raw['telemetry'];
  if (telemetry !== undefined && !isRecord(telemetry)) {
    throw new ConfigValidationError('"telemetry" must be an object if present', 'telemetry');
  }

  return {
    chain: validatedChains,
    ...(global !== undefined ? { global: validateGlobalConfig(global) } : {}),
    ...(telemetry !== undefined ? { telemetry: validateTelemetryConfig(telemetry) } : {}),
  };
}

function validateChainConfig(raw: unknown, path: string): ChainConfig {
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
      ? { limits: validateLimits(raw['limits'], `${path}.limits`) }
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

  const dsn = raw['dsn'];
  if (dsn !== undefined && typeof dsn !== 'string') {
    throw new ConfigValidationError('"dsn" must be a string if present', 'telemetry.dsn');
  }

  return {
    enabled,
    ...(typeof dsn === 'string' ? { dsn } : {}),
  };
}

function validateLimits(raw: unknown, path: string): LimitsConfig {
  if (!isRecord(raw)) {
    throw new ConfigValidationError('Limits must be an object', path);
  }

  if (typeof raw['max_single_trade'] !== 'number' || raw['max_single_trade'] <= 0) {
    throw new ConfigValidationError(
      '"max_single_trade" must be a positive number',
      `${path}.max_single_trade`,
    );
  }

  if (typeof raw['max_24h_volume'] !== 'number' || raw['max_24h_volume'] <= 0) {
    throw new ConfigValidationError(
      '"max_24h_volume" must be a positive number',
      `${path}.max_24h_volume`,
    );
  }

  return {
    max_single_trade: raw['max_single_trade'],
    max_24h_volume: raw['max_24h_volume'],
  };
}
