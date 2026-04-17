import { derivePath } from 'ed25519-hd-key';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

/** BIP-44 derivation path for Solana (ed25519, coin type 501). */
export const SOLANA_DERIVATION_PATH = "m/44'/501'/0'/0'";

/**
 * Result of deriving a Solana keypair from a seed.
 */
export interface DerivedSolanaKeypair {
  readonly publicKey: Uint8Array;
  readonly secretKey: Uint8Array;
  readonly address: string;
}

/**
 * Derive an ed25519 keypair from a BIP-39 seed and compute the Solana address.
 *
 * The derivation follows:
 * 1. Use ed25519-hd-key to derive the private key at the given path
 * 2. Use tweetnacl to produce the ed25519 keypair from the 32-byte seed
 * 3. Compute the Solana address: base58 encode of the 32-byte public key
 *
 * @param seed - 64-byte BIP-39 seed buffer
 * @param path - HD derivation path (defaults to Solana BIP-44 path)
 * @returns The derived keypair and Solana address
 */
export function deriveSolanaKeypair(
  seed: Buffer,
  path: string = SOLANA_DERIVATION_PATH,
): DerivedSolanaKeypair {
  const derived = derivePath(path, seed.toString('hex'));
  const keypair = nacl.sign.keyPair.fromSeed(new Uint8Array(derived.key));
  const address = bs58.encode(keypair.publicKey);

  return {
    publicKey: keypair.publicKey,
    secretKey: keypair.secretKey,
    address,
  };
}

/**
 * Derive an ed25519 keypair and Solana address from a raw 32-byte private key seed.
 *
 * Unlike `deriveSolanaKeypair`, this does not perform HD derivation -- it takes
 * the raw ed25519 seed directly.
 *
 * @param rawSeed - 32-byte ed25519 private key seed
 * @returns The derived keypair and Solana address
 */
export function solanaKeypairFromRawKey(rawSeed: Uint8Array): DerivedSolanaKeypair {
  if (rawSeed.length !== 32) {
    throw new Error(`Private key seed must be 32 bytes, got ${rawSeed.length}.`);
  }

  const keypair = nacl.sign.keyPair.fromSeed(rawSeed);
  const address = bs58.encode(keypair.publicKey);

  return {
    publicKey: keypair.publicKey,
    secretKey: keypair.secretKey,
    address,
  };
}
