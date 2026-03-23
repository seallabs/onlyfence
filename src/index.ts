// Core types

// Chain adapter
export {
  ChainAdapterFactory,
  coinTypeToSymbol,
  isKnownToken,
  resolveTokenAddress,
  SUI_CHAIN_ID,
  SUI_TOKEN_MAP,
  SuiAdapter,
} from './chain/index.js';
export type { ChainAdapter } from './chain/index.js';
export { SuiDataProvider } from './chain/sui/data-provider.js';
export { bootstrap, buildChainAdapterFactory, buildPolicyRegistry } from './cli/bootstrap.js';
export type { AppComponents } from './cli/bootstrap.js';
// CLI
export { createProgram } from './cli/index.js';
export { formatJsonOutput, printJsonOutput } from './cli/output.js';
export type {
  ActionPayload,
  CliOutput,
  LendingOutput,
  LendingRewardsOutput,
  LPOutput,
  SwapOutput,
} from './cli/output.js';
// Config
export {
  CONFIG_PATH,
  ConfigAlreadyExistsError,
  ConfigValidationError,
  createDefaultConfig,
  getNestedValue,
  initConfig,
  loadConfig,
  ONLYFENCE_DIR,
  parseConfigValue,
  setNestedValue,
  updateConfigFile,
  validateConfig,
} from './config/index.js';

// Data providers
export { DataProviderRegistry, DataProviderWithCache } from './core/data-provider.js';
export type { DataProvider, DataProviderFactory, TokenMetadata } from './core/data-provider.js';
export type {
  LPProCoinRecord,
  LPProServiceConfig,
  LPProTokenPrice,
} from './data/lp-pro-service.js';

// LP Pro service
export { LPProService } from './data/lp-pro-service.js';
export type {
  ActivityAction,
  ActivityCategory,
  ActivityRecord,
  ActivityRow,
  CliEvent,
  CliEventRow,
  CliStats,
  CommandStat,
} from './db/index.js';
// Database
export {
  ActivityLog,
  CliEventLog,
  DB_PATH,
  openDatabase,
  openMemoryDatabase,
  runMigrations,
} from './db/index.js';
export type { Logger, LoggerOptions } from './logger/index.js';
// Logger
export { createLogger, getLogger, hasLogger } from './logger/index.js';
// Policy engine
export type { PolicyCheck } from './policy/check.js';
export { SpendingLimitCheck, TokenAllowlistCheck } from './policy/checks/index.js';
export type { PolicyContext } from './policy/context.js';
export { PolicyCheckRegistry } from './policy/registry.js';
// Telemetry
export {
  captureException,
  closeSentry,
  initSentry,
  scrubSensitiveData,
} from './telemetry/index.js';
export type {
  AllowlistConfig,
  AppConfig,
  BalanceResult,
  ChainConfig,
  CheckResult,
  CheckStatus,
  CircuitBreakerConfig,
  DenylistConfig,
  FrequencyLimitConfig,
  GlobalConfig,
  LimitsConfig,
  ProtocolAllowlistConfig,
  Signer,
  SimulationResult,
  TelemetryConfig,
  TokenBalance,
  TxResult,
  UpdateCache,
  UpdateConfig,
  UpdateStatus,
} from './types/index.js';
// Update
export {
  compareVersions,
  createUpdateChecker,
  createUpdateInstaller,
  CURRENT_VERSION,
  DEFAULT_CACHE_TTL_MS,
  DefaultUpdateChecker,
  FileUpdateCacheService,
  GitHubReleasesSource,
  InstallError,
  ShellUpdateInstaller,
  UPDATE_CACHE_PATH,
  UpdateSourceError,
} from './update/index.js';
export type {
  UpdateCacheService,
  UpdateChecker,
  UpdateInstaller,
  UpdateSource,
} from './update/index.js';
// CAIP utilities
export { formatCAIP19 } from './utils/caip.js';
// Utils
export { toErrorMessage } from './utils/index.js';
export type {
  DerivedKeypair,
  EncryptedKeystore,
  GenerateWalletResult,
  ImportWalletResult,
  KeystoreData,
  RegisterWalletResult,
  SetupResult,
  WalletInfo,
  WalletRow,
} from './wallet/index.js';
// Wallet
export {
  decryptKeystoreData,
  DEFAULT_KEYSTORE_PATH,
  deriveSuiKeypair,
  encryptKeystoreData,
  ensureSetupEnvironment,
  generateSetupWallet,
  generateWallet,
  getPrimaryWallet,
  importFromMnemonic,
  importSetupWallet,
  listWallets,
  loadKeystore,
  publicKeyToSuiAddress,
  registerWalletAddress,
  saveKeystore,
  saveSetupKeystore,
  SUI_DERIVATION_PATH,
} from './wallet/index.js';
