export type { ChainAdapter } from './adapter.js';
export { ChainAdapterFactory } from './factory.js';

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
