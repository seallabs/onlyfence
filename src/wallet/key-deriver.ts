import type { Chain, ChainId } from '../core/action-types.js';

/**
 * Result of deriving a keypair from a seed or raw key.
 */
export interface DerivedKey {
  readonly address: string;
  readonly secretKey: Uint8Array;
  readonly derivationPath: string | null;
}

/**
 * Chain-specific key derivation strategy.
 *
 * Mnemonics (BIP-39) are chain-agnostic — the same seed derives different
 * keys for different chains via different derivation paths.
 *
 * Private key import is chain-specific — key format, parsing, and address
 * derivation vary by chain (e.g., Sui uses suiprivkey bech32, Solana uses base58).
 */
export interface KeyDeriver {
  /** Chain name (e.g., "sui") */
  readonly chain: Chain;

  /** CAIP-2 chain identifier (e.g., "sui:mainnet") */
  readonly chainId: ChainId;

  /**
   * Derive a keypair from a BIP-39 seed.
   * The seed is chain-agnostic; the derivation path is chain-specific.
   *
   * @param seed - 64-byte BIP-39 seed buffer
   * @returns Derived key with address and secret key
   */
  deriveFromSeed(seed: Buffer): DerivedKey;

  /**
   * Derive a keypair from a raw private key (already parsed into bytes).
   *
   * @param rawSeed - Raw private key bytes (chain-specific length, typically 32)
   * @returns Derived key with address and secret key
   */
  deriveFromRawKey(rawSeed: Uint8Array): DerivedKey;

  /**
   * Parse a chain-specific private key string into raw bytes.
   *
   * Each chain has its own key format:
   * - Sui: suiprivkey1... bech32 or 64-char hex
   * - Solana: base58 encoded
   * - EVM: 0x-prefixed or plain hex
   *
   * @param input - Private key string in chain-specific format
   * @returns Raw private key bytes
   * @throws Error if the input format is invalid for this chain
   */
  parsePrivateKeyInput(input: string): Uint8Array;
}

/**
 * Registry of KeyDerivers keyed by chain name.
 */
export class KeyDeriverRegistry {
  private readonly derivers = new Map<string, KeyDeriver>();

  /** Register a key deriver for a chain. */
  register(deriver: KeyDeriver): void {
    if (this.derivers.has(deriver.chain)) {
      throw new Error(
        `KeyDeriverRegistry: deriver for chain "${deriver.chain}" is already registered`,
      );
    }
    this.derivers.set(deriver.chain, deriver);
  }

  /** Retrieve the key deriver for a chain. */
  get(chain: string): KeyDeriver {
    const deriver = this.derivers.get(chain);
    if (deriver === undefined) {
      throw new Error(`KeyDeriverRegistry: no deriver registered for chain "${chain}"`);
    }
    return deriver;
  }

  /** List all registered chain names. */
  list(): string[] {
    return [...this.derivers.keys()];
  }
}
