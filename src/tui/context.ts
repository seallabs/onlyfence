import { createContext, useContext } from 'react';
import type Database from 'better-sqlite3';
import type { AppConfig } from '../types/config.js';
import type { OracleClient } from '../oracle/client.js';
import type { PolicyCheckRegistry } from '../policy/registry.js';
import type { ChainAdapterFactory } from '../chain/factory.js';

/**
 * Shared TUI context providing access to all application components.
 *
 * `config` is mutable state — it can be reloaded after TUI-based edits.
 * `mode` controls input routing: 'navigate' for global shortcuts,
 * 'edit' for inline field editing.
 */
export interface TuiContextValue {
  readonly db: Database.Database;
  readonly oracle: OracleClient;
  readonly policyRegistry: PolicyCheckRegistry;
  readonly chainAdapterFactory: ChainAdapterFactory;
  readonly config: AppConfig;
  readonly activeChain: string;
  readonly reloadConfig: () => void;
  readonly configError: string | null;
  readonly mode: 'navigate' | 'edit';
  readonly setMode: (mode: 'navigate' | 'edit') => void;
}

const TuiContext = createContext<TuiContextValue | null>(null);

export const TuiProvider = TuiContext.Provider;

/**
 * Access the TUI context from any child component.
 *
 * @throws Error if called outside of TuiProvider
 */
export function useTui(): TuiContextValue {
  const ctx = useContext(TuiContext);
  if (ctx === null) {
    throw new Error('useTui must be used within a TuiProvider');
  }
  return ctx;
}
