import type { Chain } from '../core/action-types.js';
import type {
  AllowlistConfig,
  AppConfig,
  ChainConfig,
  GlobalConfig,
  LimitsConfig,
  PerpConfig,
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

export const DEFAULT_MAX_PERP_LEVERAGE_CEILING = 100;
export const DEFAULT_MAX_PERP_SINGLE_ORDER_CEILING = 100_000;
export const DEFAULT_MAX_PERP_24H_VOLUME_CEILING = 1_000_000;
export const DEFAULT_MAX_PERP_24H_WITHDRAW_CEILING = 100_000;

/** Upper bounds passed through validation to cap per-chain limits. */
interface LimitCeilings {
  readonly tradeCeiling: number;
  readonly volumeCeiling: number;
  readonly perpLeverageCeiling: number;
  readonly perpSingleOrderCeiling: number;
  readonly perp24hVolumeCeiling: number;
  readonly perp24hWithdrawCeiling: number;
}

/**
 * Returns a default AppConfig suitable for first-time setup.
 *
 * Starts with an empty chain section — the setup wizard populates it
 * based on the user's chain selection.
 */
export function createDefaultConfig(): AppConfig {
  return {
    chain: {},
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

  // Validate security section first so we can use ceilings for limit validation
  const security = raw['security'];
  if (security !== undefined && !isRecord(security)) {
    throw new ConfigValidationError('"security" must be an object if present', 'security');
  }
  const validatedSecurity = security !== undefined ? validateSecurityConfig(security) : undefined;

  const ceilings: LimitCeilings = {
    tradeCeiling: validatedSecurity?.max_single_trade_ceiling ?? DEFAULT_MAX_SINGLE_TRADE_CEILING,
    volumeCeiling: validatedSecurity?.max_24h_volume_ceiling ?? DEFAULT_MAX_24H_VOLUME_CEILING,
    perpLeverageCeiling:
      validatedSecurity?.max_perp_leverage_ceiling ?? DEFAULT_MAX_PERP_LEVERAGE_CEILING,
    perpSingleOrderCeiling:
      validatedSecurity?.max_perp_single_order_ceiling ?? DEFAULT_MAX_PERP_SINGLE_ORDER_CEILING,
    perp24hVolumeCeiling:
      validatedSecurity?.max_perp_24h_volume_ceiling ?? DEFAULT_MAX_PERP_24H_VOLUME_CEILING,
    perp24hWithdrawCeiling:
      validatedSecurity?.max_perp_24h_withdraw_ceiling ?? DEFAULT_MAX_PERP_24H_WITHDRAW_CEILING,
  };

  const chainSection = raw['chain'];
  if (chainSection !== undefined && !isRecord(chainSection)) {
    throw new ConfigValidationError('"chain" must be an object if present', 'chain');
  }

  const validatedChains: Record<string, ChainConfig> = {};

  if (chainSection !== undefined) {
    for (const [chainName, chainValue] of Object.entries(chainSection)) {
      validatedChains[chainName] = validateChainConfig(chainValue, `chain.${chainName}`, ceilings);
    }
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

  // Validate default_chain
  const defaultChain = raw['default_chain'];
  if (defaultChain !== undefined) {
    if (typeof defaultChain !== 'string' || defaultChain.length === 0) {
      throw new ConfigValidationError(
        '"default_chain" must be a non-empty string if present',
        'default_chain',
      );
    }
    if (!(defaultChain in validatedChains)) {
      throw new ConfigValidationError(
        `"default_chain" value "${defaultChain}" must match a key in the [chain] section`,
        'default_chain',
      );
    }
  }

  return {
    chain: validatedChains,
    ...(defaultChain !== undefined ? { default_chain: defaultChain as Chain } : {}),
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

  const network = raw['network'];
  if (network !== undefined && (typeof network !== 'string' || network.length === 0)) {
    throw new ConfigValidationError(
      '"network" must be a non-empty string if present',
      `${path}.network`,
    );
  }

  const credentials = raw['credentials'];
  if (credentials !== undefined) {
    if (!isRecord(credentials)) {
      throw new ConfigValidationError(
        '"credentials" must be an object if present',
        `${path}.credentials`,
      );
    }
    for (const [key, value] of Object.entries(credentials)) {
      if (typeof value !== 'string') {
        throw new ConfigValidationError(
          `credential "${key}" must be a string`,
          `${path}.credentials.${key}`,
        );
      }
    }
  }

  return {
    rpc: raw['rpc'],
    ...(network !== undefined ? { network } : {}),
    ...(credentials !== undefined ? { credentials: credentials as Record<string, string> } : {}),
    ...(raw['allowlist'] !== undefined
      ? { allowlist: validateAllowlist(raw['allowlist'], `${path}.allowlist`) }
      : {}),
    ...(raw['limits'] !== undefined
      ? { limits: validateLimits(raw['limits'], `${path}.limits`, ceilings) }
      : {}),
    ...(raw['perp'] !== undefined
      ? { perp: validatePerpConfig(raw['perp'], `${path}.perp`, ceilings) }
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

function validatePerpConfig(raw: unknown, path: string, ceilings: LimitCeilings): PerpConfig {
  if (!isRecord(raw)) {
    throw new ConfigValidationError('Perp config must be an object', path);
  }

  // allowlist_markets
  let allowlistMarkets: readonly string[] | undefined;
  if (raw['allowlist_markets'] !== undefined) {
    if (!Array.isArray(raw['allowlist_markets'])) {
      throw new ConfigValidationError(
        '"allowlist_markets" must be an array',
        `${path}.allowlist_markets`,
      );
    }
    const seen = new Set<string>();
    for (const m of raw['allowlist_markets']) {
      if (typeof m !== 'string' || m.length === 0) {
        throw new ConfigValidationError(
          'Each entry in "allowlist_markets" must be a non-empty string',
          `${path}.allowlist_markets`,
        );
      }
      if (seen.has(m)) {
        throw new ConfigValidationError(
          `Duplicate entry "${m}" in "allowlist_markets"`,
          `${path}.allowlist_markets`,
        );
      }
      seen.add(m);
    }
    allowlistMarkets = raw['allowlist_markets'] as readonly string[];
  }

  // max_leverage has a special minimum of 1 instead of > 0
  let maxLeverage: number | undefined;
  if (raw['max_leverage'] !== undefined) {
    if (typeof raw['max_leverage'] !== 'number' || raw['max_leverage'] < 1) {
      throw new ConfigValidationError(
        '"max_leverage" must be a number >= 1',
        `${path}.max_leverage`,
      );
    }
    if (raw['max_leverage'] > ceilings.perpLeverageCeiling) {
      throw new ConfigValidationError(
        `"max_leverage" (${String(raw['max_leverage'])}) exceeds the safety ceiling of ${String(ceilings.perpLeverageCeiling)}. ` +
          `To raise the ceiling, set security.max_perp_leverage_ceiling in config.toml.`,
        `${path}.max_leverage`,
      );
    }
    maxLeverage = raw['max_leverage'];
  }

  const maxSingleOrder = validateOptionalPositiveCeilingField(
    raw,
    'max_single_order',
    path,
    ceilings.perpSingleOrderCeiling,
    'security.max_perp_single_order_ceiling',
  );
  const max24hVolume = validateOptionalPositiveCeilingField(
    raw,
    'max_24h_volume',
    path,
    ceilings.perp24hVolumeCeiling,
    'security.max_perp_24h_volume_ceiling',
  );
  const max24hWithdraw = validateOptionalPositiveCeilingField(
    raw,
    'max_24h_withdraw',
    path,
    ceilings.perp24hWithdrawCeiling,
    'security.max_perp_24h_withdraw_ceiling',
  );

  return {
    ...(allowlistMarkets !== undefined ? { allowlist_markets: allowlistMarkets } : {}),
    ...(maxLeverage !== undefined ? { max_leverage: maxLeverage } : {}),
    ...(maxSingleOrder !== undefined ? { max_single_order: maxSingleOrder } : {}),
    ...(max24hVolume !== undefined ? { max_24h_volume: max24hVolume } : {}),
    ...(max24hWithdraw !== undefined ? { max_24h_withdraw: max24hWithdraw } : {}),
  };
}

function validateOptionalPositiveCeilingField(
  raw: Record<string, unknown>,
  field: string,
  path: string,
  ceiling: number,
  ceilingConfigKey: string,
): number | undefined {
  const value = raw[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || value <= 0) {
    throw new ConfigValidationError(`"${field}" must be a positive number`, `${path}.${field}`);
  }
  if (value > ceiling) {
    throw new ConfigValidationError(
      `"${field}" (${String(value)}) exceeds the safety ceiling of ${String(ceiling)}. ` +
        `To raise the ceiling, set ${ceilingConfigKey} in config.toml.`,
      `${path}.${field}`,
    );
  }
  return value;
}

function validateOptionalPositiveNumber(
  raw: Record<string, unknown>,
  field: string,
  path: string,
): number | undefined {
  const value = raw[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || value <= 0) {
    throw new ConfigValidationError(
      `"${field}" must be a positive number if present`,
      `${path}.${field}`,
    );
  }
  return value;
}

function validateSecurityConfig(raw: Record<string, unknown>): SecurityConfig {
  const tradeCeiling = validateOptionalPositiveNumber(raw, 'max_single_trade_ceiling', 'security');
  const volumeCeiling = validateOptionalPositiveNumber(raw, 'max_24h_volume_ceiling', 'security');
  const perpLevCeiling = validateOptionalPositiveNumber(
    raw,
    'max_perp_leverage_ceiling',
    'security',
  );
  const perpOrderCeiling = validateOptionalPositiveNumber(
    raw,
    'max_perp_single_order_ceiling',
    'security',
  );
  const perpVolCeiling = validateOptionalPositiveNumber(
    raw,
    'max_perp_24h_volume_ceiling',
    'security',
  );
  const perpWithdrawCeiling = validateOptionalPositiveNumber(
    raw,
    'max_perp_24h_withdraw_ceiling',
    'security',
  );

  return {
    ...(tradeCeiling !== undefined ? { max_single_trade_ceiling: tradeCeiling } : {}),
    ...(volumeCeiling !== undefined ? { max_24h_volume_ceiling: volumeCeiling } : {}),
    ...(perpLevCeiling !== undefined ? { max_perp_leverage_ceiling: perpLevCeiling } : {}),
    ...(perpOrderCeiling !== undefined ? { max_perp_single_order_ceiling: perpOrderCeiling } : {}),
    ...(perpVolCeiling !== undefined ? { max_perp_24h_volume_ceiling: perpVolCeiling } : {}),
    ...(perpWithdrawCeiling !== undefined
      ? { max_perp_24h_withdraw_ceiling: perpWithdrawCeiling }
      : {}),
  };
}
