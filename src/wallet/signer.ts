import { loadKeystore } from './keystore.js';

/**
 * Load the raw private key bytes for a specific chain from the encrypted keystore.
 *
 * Chain-agnostic: no blockchain SDK imports. The caller is responsible for
 * constructing a chain-specific signer from the returned bytes.
 *
 * @param chain - Chain identifier as stored in the keystore (e.g., 'sui:mainnet')
 * @param password - Keystore password
 * @returns Raw private key bytes (Uint8Array)
 * @throws Error if keystore not found, wrong password, or chain key missing
 */
export function loadChainKeyBytes(chain: string, password: string): Uint8Array {
  const keystoreData = loadKeystore(password);
  const keyHex = keystoreData.keys[chain];

  if (keyHex === undefined) {
    throw new Error(
      `Keystore does not contain a key for chain "${chain}". Run "fence setup" to create a wallet.`,
    );
  }

  return Buffer.from(keyHex, 'hex');
}
