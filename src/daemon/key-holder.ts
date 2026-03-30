/**
 * Holds decrypted key material in memory for the daemon process.
 *
 * The KeyHolder is the single owner of raw key bytes. When destroyed,
 * it fills the buffer with zeros to minimize the window for memory reads.
 */

import type { ChainRegistry } from '../chain/registry.js';
import { loadKeystore } from '../wallet/keystore.js';
import type { Signer } from '../types/result.js';
import type { ChainId } from '../core/action-types.js';

export class KeyHolder {
  private readonly keyBytes: Map<string, Buffer>;
  private readonly chainRegistry: ChainRegistry;
  private destroyed = false;

  private constructor(keyBytes: Map<string, Buffer>, chainRegistry: ChainRegistry) {
    this.keyBytes = keyBytes;
    this.chainRegistry = chainRegistry;
  }

  /**
   * Create a KeyHolder by decrypting the keystore with the given password.
   *
   * @param password - The keystore password
   * @param keystorePath - Optional custom keystore path
   * @returns A KeyHolder holding decrypted key material
   */
  static fromPassword(
    password: string,
    chainRegistry: ChainRegistry,
    keystorePath?: string,
  ): KeyHolder {
    const data = loadKeystore(password, keystorePath);
    const keyBytes = new Map<string, Buffer>();

    for (const [chainId, hexKey] of Object.entries(data.keys)) {
      keyBytes.set(chainId, Buffer.from(hexKey, 'hex'));
      // Overwrite the hex string in the source object to reduce the window
      // where plaintext key material sits in GC-reachable memory.
      // This is best-effort — V8 string interning may retain copies.
      data.keys[chainId] = '0'.repeat(hexKey.length);
    }

    return new KeyHolder(keyBytes, chainRegistry);
  }

  /**
   * Get a signer for the specified chain.
   *
   * @throws Error if the KeyHolder has been destroyed or no key exists for the chain
   */
  getSigner(chainId: ChainId): Signer {
    if (this.destroyed) {
      throw new Error('KeyHolder has been destroyed — daemon must be restarted.');
    }

    const keyBuf = this.keyBytes.get(chainId);
    if (keyBuf === undefined) {
      throw new Error(
        `No key available for chain "${chainId}". Was the wallet set up for this chain?`,
      );
    }

    const chainDef = this.chainRegistry.getByChainId(chainId);
    return chainDef.walletDerivation.buildSigner(keyBuf);
  }

  /**
   * Check if a key is available for the given chain.
   */
  hasKey(chainId: ChainId): boolean {
    return !this.destroyed && this.keyBytes.has(chainId);
  }

  /**
   * Zero all key material and mark this holder as destroyed.
   *
   * After calling destroy(), getSigner() will throw.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    for (const buf of this.keyBytes.values()) {
      buf.fill(0);
    }
    this.keyBytes.clear();
  }
}
