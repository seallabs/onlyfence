import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import type { Signer } from '../../types/result.js';

/**
 * Build a Sui Signer from raw ed25519 private key bytes.
 *
 * Handles both 32-byte (seed) and 64-byte (tweetnacl format: seed + pubkey) keys.
 * The 64-byte format is what `deriveSuiKeypair` stores in the keystore.
 *
 * @param keyBytes - Raw private key bytes from keystore or session
 * @returns Signer with Sui address, public key, and sign method
 */
export function buildSuiSigner(keyBytes: Uint8Array): Signer {
  const seed = keyBytes.length === 64 ? keyBytes.subarray(0, 32) : keyBytes;
  const keypair = Ed25519Keypair.fromSecretKey(seed);

  const publicKey = keypair.getPublicKey().toRawBytes();
  const address = keypair.toSuiAddress();

  return {
    address,
    publicKey,
    sign: (data: Uint8Array): Promise<Uint8Array> => keypair.sign(data),
  };
}
