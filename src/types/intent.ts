// Re-export from core for backward compatibility during migration.
// TradeAction -> DeFiAction, TradeIntent -> ActionIntent.
export type { DeFiAction as TradeAction } from '../core/action-types.js';
export type { ActionIntent as TradeIntent } from '../core/action-types.js';
