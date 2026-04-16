import { privateKeyToAccount } from 'viem/accounts';
import type { Signer } from '../../types/result.js';
import { privateKeyHexFromBytes } from './derivation.js';

/**
 * Build an EVM Signer from raw secp256k1 private key bytes.
 *
 * All EVM action builders use the `off-chain-signed` execution strategy
 * and construct their own viem / ethers clients from the session key,
 * so `signTransaction` is left as an explicit unsupported guard to
 * catch any future on-chain path loudly rather than silently mis-signing.
 */
export function buildEvmSigner(keyBytes: Uint8Array): Signer {
  if (keyBytes.length !== 32) {
    throw new Error(`EVM signer expects 32-byte private key, got ${keyBytes.length}.`);
  }
  const account = privateKeyToAccount(privateKeyHexFromBytes(keyBytes));

  return {
    address: account.address,
    publicKey: keyBytes,
    signTransaction: (_data: Uint8Array) =>
      Promise.reject(
        new Error(
          'EVM builders use the off-chain-signed execution strategy — raw byte signing via Signer is not supported. ' +
            'Use the ParaswapSwapBuilder / AaveLend* / Hyperliquid* builders directly.',
        ),
      ),
  };
}
