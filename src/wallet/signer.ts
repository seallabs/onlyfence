import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import type { Signer } from '../types/result.js';
import { loadKeystore } from './keystore.js';
import { SUI_DERIVATION_PATH } from './derivation.js';

/**
 * Build a Signer from an Ed25519Keypair.
 *
 * Extracts the address, 32-byte public key, and sign method
 * into the generic Signer interface.
 */
function keypairToSigner(keypair: Ed25519Keypair): Signer {
  const publicKey = keypair.getPublicKey().toRawBytes();
  const address = keypair.toSuiAddress();

  return {
    address,
    publicKey,
    sign: (data: Uint8Array): Promise<Uint8Array> => keypair.sign(data),
  };
}

/**
 * Resolve a Sui signer using the following priority:
 *
 * 1. `SUI_PRIVATE_KEY` env var — bech32-encoded private key
 * 2. `SUI_MNEMONIC` env var — BIP-39 mnemonic with standard derivation path
 * 3. Encrypted keystore — loads keystore with password, reads `keys.sui` hex key
 *
 * @param password - Optional password for keystore decryption (priority 3)
 * @returns Signer with address, publicKey, and sign method
 * @throws Error if no key source is available or decryption fails
 */
export function resolveSuiSigner(password?: string): Signer {
  // Priority 1: SUI_PRIVATE_KEY env var
  const privateKey = process.env['SUI_PRIVATE_KEY'];
  if (privateKey !== undefined && privateKey !== '') {
    const keypair = Ed25519Keypair.fromSecretKey(privateKey);
    return keypairToSigner(keypair);
  }

  // Priority 2: SUI_MNEMONIC env var
  const mnemonic = process.env['SUI_MNEMONIC'];
  if (mnemonic !== undefined && mnemonic !== '') {
    const path = process.env['SUI_DERIVATION_PATH'] ?? SUI_DERIVATION_PATH;
    const keypair = Ed25519Keypair.deriveKeypair(mnemonic, path);
    return keypairToSigner(keypair);
  }

  // Priority 3: Encrypted keystore
  if (password === undefined || password === '') {
    throw new Error(
      'No signer available. Set SUI_PRIVATE_KEY, SUI_MNEMONIC, or provide a keystore password.',
    );
  }

  const keystoreData = loadKeystore(password);
  const suiKeyHex = keystoreData.keys['sui'];
  if (suiKeyHex === undefined) {
    throw new Error('Keystore does not contain a Sui key. Run "fence setup" to create a wallet.');
  }

  const secretKeyBytes = Buffer.from(suiKeyHex, 'hex');
  // The keystore may store 64 bytes (tweetnacl format: 32-byte seed + 32-byte public key).
  // Ed25519Keypair.fromSecretKey expects exactly 32 bytes (the seed).
  const seed = secretKeyBytes.length === 64 ? secretKeyBytes.subarray(0, 32) : secretKeyBytes;
  const keypair = Ed25519Keypair.fromSecretKey(seed);
  return keypairToSigner(keypair);
}
