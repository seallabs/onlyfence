import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import type { ChainDefinition } from '../registry.js';
import {
  deriveSuiKeypair,
  keypairFromRawKey,
  SUI_DERIVATION_PATH,
} from '../../wallet/derivation.js';
import { buildSuiSigner } from './signer.js';
import { SUI_DEFAULT_CHAIN_CONFIG } from './defaults.js';

/**
 * Parse a Sui-specific private key format (`suiprivkey1...` bech32).
 *
 * @param input - Private key string
 * @returns Raw 32-byte ed25519 seed
 * @throws Error if the format is not a suiprivkey bech32 key or not ED25519
 */
function parseSuiPrivateKey(input: string): Uint8Array {
  const decoded = decodeSuiPrivateKey(input);
  if (decoded.scheme !== 'ED25519') {
    throw new Error(`Unsupported key scheme "${decoded.scheme}". Only ED25519 keys are supported.`);
  }
  return decoded.secretKey;
}

/** Static chain definition for Sui. */
export const SUI_CHAIN_DEFINITION: ChainDefinition = {
  name: 'sui',
  displayName: 'Sui',
  defaultChainId: 'sui:mainnet',
  defaultRpc: 'https://fullnode.mainnet.sui.io:443',
  defaultConfig: SUI_DEFAULT_CHAIN_CONFIG,
  walletDerivation: {
    derivationPath: SUI_DERIVATION_PATH,
    deriveFromSeed: (seed: Buffer) => deriveSuiKeypair(seed),
    deriveFromRawKey: (rawSeed: Uint8Array) => keypairFromRawKey(rawSeed),
    parsePrivateKey: (input: string) => parseSuiPrivateKey(input),
    buildSigner: (keyBytes: Uint8Array) => buildSuiSigner(keyBytes),
  },
};
