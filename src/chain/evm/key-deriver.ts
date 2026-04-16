import type { DerivedKey, KeyDeriver } from '../../wallet/key-deriver.js';
import { EVM_CHAIN_ID } from './adapter.js';
import {
  EVM_DERIVATION_PATH,
  deriveEvmKeypair,
  evmKeypairFromRawKey,
  hexToPrivateKeyBytes,
} from './derivation.js';

/**
 * EVM key deriver — BIP-39 mnemonic import plus raw private key import
 * in the `0x`-prefixed or plain 64-char hex format MetaMask exports.
 */
export class EvmKeyDeriver implements KeyDeriver {
  readonly chain = 'ethereum' as const;
  readonly chainId = EVM_CHAIN_ID;

  deriveFromSeed(seed: Buffer): DerivedKey {
    const keypair = deriveEvmKeypair(seed);
    return {
      address: keypair.address,
      secretKey: keypair.secretKey,
      derivationPath: EVM_DERIVATION_PATH,
    };
  }

  deriveFromRawKey(rawSeed: Uint8Array): DerivedKey {
    const keypair = evmKeypairFromRawKey(rawSeed);
    return {
      address: keypair.address,
      secretKey: keypair.secretKey,
      derivationPath: null,
    };
  }

  parsePrivateKeyInput(input: string): Uint8Array {
    return hexToPrivateKeyBytes(input.trim());
  }
}
