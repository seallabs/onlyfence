export {
  generateWallet,
  importFromMnemonic,
  registerWalletAddress,
  listWallets,
  getPrimaryWallet,
} from './manager.js';
export type { GenerateWalletResult, ImportWalletResult, RegisterWalletResult } from './manager.js';

export {
  saveKeystore,
  loadKeystore,
  encryptKeystoreData,
  decryptKeystoreData,
  DEFAULT_KEYSTORE_PATH,
  MIN_PASSWORD_LENGTH,
} from './keystore.js';

export { deriveSuiKeypair, publicKeyToSuiAddress, SUI_DERIVATION_PATH } from './derivation.js';
export type { DerivedKeypair } from './derivation.js';

export type {
  WalletInfo,
  KeystoreData,
  EncryptedKeystore,
  WalletRow,
  SessionData,
} from './types.js';

export { loadChainKeyBytes } from './signer.js';

export { createSession, loadSessionKeyBytes, destroySession, hasActiveSession } from './session.js';

export {
  ensureSetupEnvironment,
  generateSetupWallet,
  importSetupWallet,
  saveSetupKeystore,
} from './setup.js';
export type { SetupResult } from './setup.js';
