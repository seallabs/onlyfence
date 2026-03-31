import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import type { KeyDeriver, DerivedKey } from '../../wallet/key-deriver.js';
import {
  deriveSuiKeypair,
  keypairFromRawKey,
  SUI_DERIVATION_PATH,
} from '../../wallet/derivation.js';
import { SUI_CHAIN_ID } from './adapter.js';

/**
 * Sui-specific key deriver.
 *
 * Handles:
 * - BIP-39 seed → ed25519 keypair via Sui's BIP-44 derivation path
 * - Raw 32-byte private key → ed25519 keypair + Sui address
 * - Private key parsing: suiprivkey1... bech32 or 64-char hex
 */
export class SuiKeyDeriver implements KeyDeriver {
  readonly chain = 'sui' as const;
  readonly chainId = SUI_CHAIN_ID;

  deriveFromSeed(seed: Buffer): DerivedKey {
    const keypair = deriveSuiKeypair(seed);
    return {
      address: keypair.address,
      secretKey: keypair.secretKey,
      derivationPath: SUI_DERIVATION_PATH,
    };
  }

  deriveFromRawKey(rawSeed: Uint8Array): DerivedKey {
    const keypair = keypairFromRawKey(rawSeed);
    return {
      address: keypair.address,
      secretKey: keypair.secretKey,
      derivationPath: null,
    };
  }

  parsePrivateKeyInput(input: string): Uint8Array {
    const trimmed = input.trim();

    if (trimmed.startsWith('suiprivkey')) {
      const decoded = decodeSuiPrivateKey(trimmed);
      if (decoded.scheme !== 'ED25519') {
        throw new Error(
          `Unsupported key scheme "${decoded.scheme}". Only ED25519 keys are supported.`,
        );
      }
      return decoded.secretKey;
    }

    // Hex format: must be exactly 64 hex chars (32 bytes)
    if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      throw new Error(
        'Invalid private key format. Expected 64-character hex string or suiprivkey1… bech32 key.',
      );
    }

    return new Uint8Array(Buffer.from(trimmed, 'hex'));
  }
}
