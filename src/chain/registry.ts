import type { ChainConfig } from '../types/config.js';
import type { Signer } from '../types/result.js';
import { SUI_CHAIN_DEFINITION } from './sui/definition.js';

/**
 * Result of deriving a wallet keypair from a seed or raw key.
 */
export interface DerivedWalletResult {
  readonly publicKey: Uint8Array;
  readonly secretKey: Uint8Array;
  readonly address: string;
}

/**
 * Describes how a chain derives wallets and builds signers.
 *
 * This abstraction lets chain-agnostic code (wallet manager, setup, daemon)
 * generate wallets and sign transactions without importing chain-specific SDKs.
 */
export interface WalletDerivationDescriptor {
  /** BIP-44 derivation path (e.g., "m/44'/784'/0'/0'/0'" for Sui) */
  readonly derivationPath: string;

  /**
   * Derive a keypair from a BIP-39 seed.
   *
   * @param seed - 64-byte BIP-39 seed buffer
   * @returns Derived keypair and address
   */
  deriveFromSeed(seed: Buffer): DerivedWalletResult;

  /**
   * Derive a keypair from a raw 32-byte private key seed.
   *
   * @param rawSeed - 32-byte ed25519 private key seed
   * @returns Derived keypair and address
   */
  deriveFromRawKey(rawSeed: Uint8Array): DerivedWalletResult;

  /**
   * Parse a chain-specific private key format into raw bytes.
   * E.g., `suiprivkey1...` bech32 format for Sui.
   *
   * If not provided, only hex format is supported.
   *
   * @param input - Chain-specific key string
   * @returns Raw 32-byte private key seed
   * @throws Error if the format is unrecognized
   */
  parsePrivateKey?(input: string): Uint8Array;

  /**
   * Build a Signer from raw private key bytes.
   *
   * @param keyBytes - Raw private key bytes
   * @returns A Signer capable of signing transactions for this chain
   */
  buildSigner(keyBytes: Uint8Array): Signer;
}

/**
 * Static definition of a supported blockchain.
 *
 * Registered in the ChainRegistry at startup. Provides all the metadata
 * and capabilities needed for chain-agnostic code to interact with the chain.
 */
export interface ChainDefinition {
  /** Short chain name used as config key and registry key (e.g., "sui", "solana") */
  readonly name: string;

  /** Human-readable display name (e.g., "Sui", "Solana") */
  readonly displayName: string;

  /** Default CAIP-2 chain identifier (e.g., "sui:mainnet") */
  readonly defaultChainId: string;

  /** Default RPC endpoint URL */
  readonly defaultRpc: string;

  /** Default chain configuration (allowlist, limits, etc.) */
  readonly defaultConfig: ChainConfig;

  /** Wallet derivation and signing capabilities */
  readonly walletDerivation: WalletDerivationDescriptor;
}

/**
 * Registry of all supported blockchains.
 *
 * This is the single source of truth for "what chains does OnlyFence support?"
 * Chain-agnostic code (wallet manager, setup, bootstrap, CLI, TUI) queries
 * this registry instead of importing chain-specific modules.
 */
export class ChainRegistry {
  private readonly chains = new Map<string, ChainDefinition>();

  /**
   * Register a chain definition.
   *
   * @param def - Chain definition to register
   * @throws Error if a chain with the same name is already registered
   */
  register(def: ChainDefinition): void {
    if (this.chains.has(def.name)) {
      throw new Error(`ChainRegistry: chain "${def.name}" is already registered`);
    }
    this.chains.set(def.name, def);
  }

  /**
   * Get a chain definition by name.
   *
   * @param name - Short chain name (e.g., "sui")
   * @returns The chain definition
   * @throws Error if the chain is not registered
   */
  get(name: string): ChainDefinition {
    const def = this.chains.get(name);
    if (def === undefined) {
      throw new Error(
        `ChainRegistry: chain "${name}" is not registered. Available: ${this.names().join(', ')}`,
      );
    }
    return def;
  }

  /**
   * Check if a chain is registered.
   */
  has(name: string): boolean {
    return this.chains.has(name);
  }

  /**
   * Get all registered chain definitions.
   */
  list(): ChainDefinition[] {
    return [...this.chains.values()];
  }

  /**
   * Get all registered chain names.
   */
  names(): string[] {
    return [...this.chains.keys()];
  }

  /**
   * Look up a chain definition by CAIP-2 chain ID.
   * Extracts the chain name from the chain ID prefix (before ':').
   *
   * @param chainId - CAIP-2 chain ID (e.g., "sui:mainnet")
   * @returns The chain definition
   * @throws Error if the chain is not registered
   */
  getByChainId(chainId: string): ChainDefinition {
    const name = chainId.split(':')[0];
    if (name === undefined || name === '') {
      throw new Error(`ChainRegistry: invalid chain ID "${chainId}"`);
    }
    return this.get(name);
  }
}

/**
 * Build a ChainRegistry populated with all supported chains.
 *
 * This is the canonical way to create a registry — add new chains here.
 */
export function buildChainRegistry(): ChainRegistry {
  const registry = new ChainRegistry();
  registry.register(SUI_CHAIN_DEFINITION);
  return registry;
}
