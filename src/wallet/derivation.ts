import { derivePath } from 'ed25519-hd-key';
import nacl from 'tweetnacl';
import { blake2b } from '@noble/hashes/blake2';

/** BIP-44 derivation path for Sui (ed25519). */
export const SUI_DERIVATION_PATH = "m/44'/784'/0'/0'/0'";

/** ed25519 signature scheme flag byte used by Sui. */
const ED25519_FLAG = 0x00;

/** Length of a Sui address in bytes (32 bytes = 64 hex chars). */
const SUI_ADDRESS_LENGTH = 32;

/**
 * Result of deriving a Sui keypair from a seed.
 */
export interface DerivedKeypair {
  readonly publicKey: Uint8Array;
  readonly secretKey: Uint8Array;
  readonly address: string;
}

/**
 * Derive an ed25519 keypair from a BIP-39 seed and compute the Sui address.
 *
 * The derivation follows:
 * 1. Use ed25519-hd-key to derive the private key at the given path
 * 2. Use tweetnacl to produce the ed25519 keypair from the 32-byte seed
 * 3. Compute the Sui address: BLAKE2b-256(0x00 || publicKey), hex-encoded with 0x prefix
 *
 * @param seed - 64-byte BIP-39 seed buffer
 * @param path - HD derivation path (defaults to Sui BIP-44 path)
 * @returns The derived keypair and Sui address
 * @throws Error if the derivation path is invalid or seed is malformed
 */
export function deriveSuiKeypair(seed: Buffer, path: string = SUI_DERIVATION_PATH): DerivedKeypair {
  const derived = derivePath(path, seed.toString('hex'));
  const keypair = nacl.sign.keyPair.fromSeed(new Uint8Array(derived.key));

  const address = publicKeyToSuiAddress(keypair.publicKey);

  return {
    publicKey: keypair.publicKey,
    secretKey: keypair.secretKey,
    address,
  };
}

/**
 * Convert an ed25519 public key to a Sui address.
 *
 * Address = 0x + hex(BLAKE2b-256(0x00 || publicKey))[:32 bytes]
 *
 * @param publicKey - 32-byte ed25519 public key
 * @returns Sui address string with 0x prefix
 */
export function publicKeyToSuiAddress(publicKey: Uint8Array): string {
  const payload = new Uint8Array(1 + publicKey.length);
  payload[0] = ED25519_FLAG;
  payload.set(publicKey, 1);

  const hash = blake2b(payload, { dkLen: SUI_ADDRESS_LENGTH });
  const hexAddress = Buffer.from(hash).toString('hex');

  return `0x${hexAddress}`;
}
