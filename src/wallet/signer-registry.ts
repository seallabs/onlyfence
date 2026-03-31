import type { Signer } from '../types/result.js';

/**
 * Factory function that creates a Signer from raw key bytes.
 */
export type SignerFactory = (keyBytes: Uint8Array) => Signer;

/**
 * Registry for chain-specific signer factories.
 *
 * Each chain registers a factory that knows how to produce a Signer
 * from raw key bytes. The registry dispatches based on the chain prefix
 * extracted from a CAIP-2 chain identifier (e.g., "sui" from "sui:mainnet").
 */
export class SignerRegistry {
  private readonly factories = new Map<string, SignerFactory>();

  /**
   * Register a signer factory for a chain.
   *
   * @param chain - Chain name (e.g., "sui", "solana")
   * @param factory - Function that creates a Signer from raw key bytes
   */
  register(chain: string, factory: SignerFactory): void {
    if (this.factories.has(chain)) {
      throw new Error(`SignerRegistry: factory for chain "${chain}" is already registered`);
    }
    this.factories.set(chain, factory);
  }

  /**
   * Build a Signer for the given chain from raw key bytes.
   *
   * @param chainId - CAIP-2 chain identifier (e.g., "sui:mainnet")
   * @param keyBytes - Raw private key bytes
   * @returns Signer instance
   * @throws if no factory is registered for the chain prefix
   */
  build(chainId: string, keyBytes: Uint8Array): Signer {
    const chain = chainId.split(':')[0] ?? '';
    const factory = this.factories.get(chain);
    if (factory === undefined) {
      throw new Error(
        `SignerRegistry: no signer factory registered for chain "${chain}" (chainId: "${chainId}")`,
      );
    }
    return factory(keyBytes);
  }

  /** Check if a factory is registered for the given chain. */
  has(chain: string): boolean {
    return this.factories.has(chain);
  }
}
