// Core types
export type {
  TradeIntent,
  TradeAction,
  CheckStatus,
  CheckResult,
  SwapParams,
  SwapQuote,
  TransactionData,
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
export { TradeLog } from './db/index.js';
export type { TradeRecord, TradeRow } from './db/index.js';

// Oracle
export type { OracleClient } from './oracle/index.js';
export { CoinGeckoOracle, resolveTokenId } from './oracle/index.js';
export type { CoinGeckoOracleConfig } from './oracle/index.js';

// Chain adapter
export type { ChainAdapter } from './chain/index.js';
export { ChainAdapterFactory } from './chain/index.js';
export { SuiAdapter, SUI_TOKEN_MAP, resolveTokenAddress, isKnownToken } from './chain/index.js';

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

// Utils
export { toErrorMessage } from './utils/index.js';
