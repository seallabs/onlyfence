import bs58 from 'bs58';
import type { KeyDeriver, DerivedKey } from '../../wallet/key-deriver.js';
import {
  deriveSolanaKeypair,
  solanaKeypairFromRawKey,
  SOLANA_DERIVATION_PATH,
} from './derivation.js';
import { SOLANA_CHAIN_ID } from './adapter.js';

/**
 * Solana-specific key deriver.
 *
 * Handles:
 * - BIP-39 seed -> ed25519 keypair via Solana's BIP-44 derivation path
 * - Raw 32-byte private key -> ed25519 keypair + Solana address
 * - Private key parsing: base58 (64-byte keypair) or 64-char hex (32-byte seed)
 */
export class SolanaKeyDeriver implements KeyDeriver {
  readonly chain = 'solana' as const;
  readonly chainId = SOLANA_CHAIN_ID;

  deriveFromSeed(seed: Buffer): DerivedKey {
    const keypair = deriveSolanaKeypair(seed);
    return {
      address: keypair.address,
      secretKey: keypair.secretKey,
      derivationPath: SOLANA_DERIVATION_PATH,
    };
  }

  deriveFromRawKey(rawSeed: Uint8Array): DerivedKey {
    const keypair = solanaKeypairFromRawKey(rawSeed);
    return {
      address: keypair.address,
      secretKey: keypair.secretKey,
      derivationPath: null,
    };
  }

  parsePrivateKeyInput(input: string): Uint8Array {
    const trimmed = input.trim();

    // Try base58 decode first (Phantom/Solflare export format: 64-byte keypair)
    if (/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(trimmed)) {
      try {
        const decoded = bs58.decode(trimmed);
        if (decoded.length === 64) {
          // Full keypair (seed + pubkey) -- extract the 32-byte seed
          return decoded.subarray(0, 32);
        }
        if (decoded.length === 32) {
          return decoded;
        }
      } catch {
        // Not valid base58, fall through to hex check
      }
    }

    // Hex format: must be exactly 64 hex chars (32 bytes)
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      return new Uint8Array(Buffer.from(trimmed, 'hex'));
    }

    throw new Error(
      'Invalid private key format. Expected base58-encoded keypair or 64-character hex string.',
    );
  }
}
