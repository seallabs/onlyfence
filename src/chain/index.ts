export type { ChainAdapter } from './adapter.js';
export { ChainAdapterFactory } from './factory.js';
export type {
  ChainModule,
  ChainModuleInfo,
  ChainRegistrationContext,
  CredentialRequirement,
} from './chain-module.js';
export { ChainModuleRegistry } from './module-registry.js';

// Sui-specific exports — prefer importing from './sui/index.js' directly.
// Kept here for backwards compatibility with existing consumers.
export {
  SuiAdapter,
  SUI_CHAIN_ID,
  SUI_TOKEN_MAP,
  resolveTokenAddress,
  isKnownToken,
  coinTypeToSymbol,
} from './sui/index.js';
