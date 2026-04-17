import type { ChainAdapter } from './adapter.js';

/**
 * Registry and factory for chain adapters.
 *
 * Adapters are registered by their `chain` identifier and can be retrieved
 * on demand. This enables extensibility: new chains are added by implementing
 * ChainAdapter and calling `register()` — no existing code changes required.
 */
export class ChainAdapterFactory {
  private readonly adapters = new Map<string, ChainAdapter>();

  /**
   * Register a chain adapter. Throws if an adapter for the same chain
   * is already registered.
   */
  register(adapter: ChainAdapter): void {
    if (this.adapters.has(adapter.chain)) {
      throw new Error(
        `ChainAdapterFactory: adapter for chain "${adapter.chain}" is already registered`,
      );
    }
    this.adapters.set(adapter.chain, adapter);
  }

  /**
   * Retrieve an adapter by chain identifier.
   * Accepts any string to support dynamic chain resolution from CLI options.
   * @throws if no adapter is registered for the given chain.
   */
  get(chain: string): ChainAdapter {
    const adapter = this.adapters.get(chain);
    if (adapter === undefined) {
      throw new Error(`ChainAdapterFactory: no adapter registered for chain "${chain}"`);
    }
    return adapter;
  }

  /** Check whether an adapter is registered for the given chain. */
  has(chain: string): boolean {
    return this.adapters.has(chain);
  }

  /** Return the list of registered chain identifiers. */
  list(): string[] {
    return [...this.adapters.keys()];
  }
}
