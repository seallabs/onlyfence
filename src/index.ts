// Core types
export type {
  TradeIntent,
  TradeAction,
  CheckStatus,
  CheckResult,
  SimulationResult,
  TxResult,
  BalanceResult,
  TokenBalance,
  Signer,
  AllowlistConfig,
  LimitsConfig,
  DenylistConfig,
  ProtocolAllowlistConfig,
  CircuitBreakerConfig,
  FrequencyLimitConfig,
  ChainConfig,
  GlobalConfig,
  AppConfig,
  TelemetryConfig,
  UpdateConfig,
  UpdateCache,
  UpdateStatus,
} from './types/index.js';

// Policy engine
export type { PolicyCheck } from './policy/check.js';
export type { PolicyContext } from './policy/context.js';
export { PolicyCheckRegistry } from './policy/registry.js';
export { TokenAllowlistCheck, SpendingLimitCheck } from './policy/checks/index.js';

// Config
export {
  loadConfig,
  initConfig,
  updateConfigFile,
  ONLYFENCE_DIR,
  CONFIG_PATH,
  validateConfig,
  createDefaultConfig,
  ConfigValidationError,
  ConfigAlreadyExistsError,
  getNestedValue,
  setNestedValue,
  parseConfigValue,
} from './config/index.js';

// Database
export { openDatabase, openMemoryDatabase, DB_PATH } from './db/index.js';
export { runMigrations } from './db/index.js';
export { TradeLog, CliEventLog } from './db/index.js';
export type {
  TradeRecord,
  TradeRow,
  CliEvent,
  CliEventRow,
  CommandStat,
  CliStats,
} from './db/index.js';

// Oracle
export type { OracleClient } from './oracle/index.js';
export { CoinGeckoOracle, resolveTokenId } from './oracle/index.js';
export type { CoinGeckoOracleConfig } from './oracle/index.js';

// Chain adapter
export type { ChainAdapter } from './chain/index.js';
export { ChainAdapterFactory } from './chain/index.js';
export {
  SuiAdapter,
  SUI_CHAIN_ID,
  SUI_TOKEN_MAP,
  resolveTokenAddress,
  isKnownToken,
  coinTypeToSymbol,
} from './chain/index.js';

// CAIP utilities
export { formatCAIP19 } from './utils/caip.js';

// Wallet
export {
  generateWallet,
  importFromMnemonic,
  registerWalletAddress,
  listWallets,
  getPrimaryWallet,
  saveKeystore,
  loadKeystore,
  encryptKeystoreData,
  decryptKeystoreData,
  DEFAULT_KEYSTORE_PATH,
  deriveSuiKeypair,
  publicKeyToSuiAddress,
  SUI_DERIVATION_PATH,
} from './wallet/index.js';
export type {
  GenerateWalletResult,
  ImportWalletResult,
  RegisterWalletResult,
  DerivedKeypair,
  WalletInfo,
  KeystoreData,
  EncryptedKeystore,
  WalletRow,
  SetupResult,
} from './wallet/index.js';
export {
  ensureSetupEnvironment,
  generateSetupWallet,
  importSetupWallet,
  saveSetupKeystore,
} from './wallet/index.js';

// CLI
export { createProgram } from './cli/index.js';
export { bootstrap, buildPolicyRegistry, buildChainAdapterFactory } from './cli/bootstrap.js';
export type { AppComponents } from './cli/bootstrap.js';
export type { SuccessResponse, RejectionResponse, ErrorResponse, CliOutput } from './cli/output.js';
export { formatJsonOutput, printJsonOutput } from './cli/output.js';

// Logger
export { createLogger, getLogger, hasLogger } from './logger/index.js';
export type { Logger, LoggerOptions } from './logger/index.js';

// Telemetry
export {
  initSentry,
  captureException,
  closeSentry,
  scrubSensitiveData,
} from './telemetry/index.js';

// Update
export type {
  UpdateSource,
  UpdateCacheService,
  UpdateChecker,
  UpdateInstaller,
} from './update/index.js';
export {
  CURRENT_VERSION,
  UpdateSourceError,
  GitHubReleasesSource,
  FileUpdateCacheService,
  UPDATE_CACHE_PATH,
  DEFAULT_CACHE_TTL_MS,
  DefaultUpdateChecker,
  compareVersions,
  ShellUpdateInstaller,
  InstallError,
  createUpdateChecker,
  createUpdateInstaller,
} from './update/index.js';

// Utils
export { toErrorMessage } from './utils/index.js';
