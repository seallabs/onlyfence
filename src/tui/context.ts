import type Database from 'better-sqlite3';
import { createContext, useContext } from 'react';
import type { ChainAdapterFactory } from '../chain/factory.js';
import type { Chain, ChainId } from '../core/action-types.js';
import type { DataProvider } from '../core/data-provider.js';
import type { ActivityLog } from '../db/activity-log.js';
import type { PolicyCheckRegistry } from '../policy/registry.js';
import type { AppConfig } from '../types/config.js';
import type { UpdateStatus } from '../types/update.js';

/**
 * Shared TUI context providing access to all application components.
 *
 * `config` is mutable state — it can be reloaded after TUI-based edits.
 * `mode` controls input routing: 'navigate' for global shortcuts,
 * 'edit' for inline field editing.
 */
export interface TuiContextValue {
  readonly db: Database.Database;
  readonly dataProvider: DataProvider;
  readonly activityLog: ActivityLog;
  readonly policyRegistry: PolicyCheckRegistry;
  readonly chainAdapterFactory: ChainAdapterFactory;
  readonly config: AppConfig;
  /** Short chain alias for config key lookup (e.g., "sui") */
  readonly activeChain: Chain;
  /** CAIP-2 chain ID for DB queries (e.g., "sui:mainnet") */
  readonly activeChainId: ChainId;
  readonly reloadConfig: () => void;
  readonly configError: string | null;
  readonly mode: 'navigate' | 'edit';
  readonly setMode: (mode: 'navigate' | 'edit') => void;
  readonly updateStatus: UpdateStatus;
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
