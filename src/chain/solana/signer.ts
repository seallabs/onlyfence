import { Keypair, VersionedTransaction } from '@solana/web3.js';
import type { Signer } from '../../types/result.js';

/**
 * Build a Solana Signer from raw ed25519 private key bytes.
 *
 * Handles both 32-byte (seed) and 64-byte (seed + pubkey) keys.
 * The 64-byte format is what `deriveSolanaKeypair` stores in the keystore.
 *
 * @param keyBytes - Raw private key bytes from keystore or session
 * @returns Signer with Solana address, public key, and sign method
 */
export function buildSolanaSigner(keyBytes: Uint8Array): Signer {
  // Keypair.fromSecretKey expects 64 bytes (seed + pubkey).
  // If we have 32 bytes (seed only), generate the full keypair first.
  const keypair =
    keyBytes.length === 64
      ? Keypair.fromSecretKey(keyBytes)
      : Keypair.fromSeed(keyBytes.subarray(0, 32));

  const publicKey = keypair.publicKey.toBytes();
  const address = keypair.publicKey.toBase58();

  return {
    address,
    publicKey,
    signTransaction: (data: Uint8Array) => {
      const tx = VersionedTransaction.deserialize(data);
      tx.sign([keypair]);

      const serialized = tx.serialize();
      const signature = Buffer.from(tx.signatures[0] ?? new Uint8Array()).toString('base64');

      return Promise.resolve({
        signature,
        bytes: Buffer.from(serialized).toString('base64'),
      });
    },
  };
}
