import type { ChainModule, ChainModuleInfo } from './chain-module.js';

/**
 * Registry of available chain modules.
 *
 * Modules are registered at startup. During bootstrap, the registry is
 * consulted for each chain in config.toml to find and initialize the
 * corresponding module.
 */
export class ChainModuleRegistry {
  private readonly modules = new Map<string, ChainModule>();

  /** Register a chain module. Throws if a module for the same chain is already registered. */
  register(mod: ChainModule): void {
    const chain = mod.info.chain;
    if (this.modules.has(chain)) {
      throw new Error(`ChainModuleRegistry: module for chain "${chain}" is already registered`);
    }
    this.modules.set(chain, mod);
  }

  /** Retrieve the module for a chain. Throws if not registered. */
  get(chain: string): ChainModule {
    const mod = this.modules.get(chain);
    if (mod === undefined) {
      throw new Error(`ChainModuleRegistry: no module registered for chain "${chain}"`);
    }
    return mod;
  }

  /** Check whether a module is registered for the given chain. */
  has(chain: string): boolean {
    return this.modules.has(chain);
  }

  /** Return the list of registered chain names. */
  list(): string[] {
    return [...this.modules.keys()];
  }

  /** Get the static info for a chain (for setup wizard display). */
  getInfo(chain: string): ChainModuleInfo {
    return this.get(chain).info;
  }

  /** Get info for all registered chain modules. */
  listInfo(): readonly ChainModuleInfo[] {
    return [...this.modules.values()].map((m) => m.info);
  }

  /** Dispose all registered modules. Safe to call multiple times. */
  async disposeAll(): Promise<void> {
    const errors: unknown[] = [];
    for (const mod of this.modules.values()) {
      if (mod.dispose !== undefined) {
        try {
          await mod.dispose();
        } catch (err: unknown) {
          errors.push(err);
        }
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, 'Errors disposing chain modules');
    }
  }
}
