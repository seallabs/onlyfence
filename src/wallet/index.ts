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
} from './keystore.js';

export { deriveSuiKeypair, publicKeyToSuiAddress, SUI_DERIVATION_PATH } from './derivation.js';
export type { DerivedKeypair } from './derivation.js';

export type { WalletInfo, KeystoreData, EncryptedKeystore, WalletRow } from './types.js';
