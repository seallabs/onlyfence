/**
 * In-memory rolling 24h trade window for fast policy checks in the daemon.
 *
 * Implements the same interface as TradeLog for volume queries,
 * but backed by an in-memory ring buffer instead of SQLite.
 * This avoids SQLite contention and provides sub-millisecond policy checks.
 */

import type { ActivityAction, ChainId } from '../core/action-types.js';
import type { ActivityLogReader } from '../db/activity-log.js';

interface TradeEntry {
  readonly chainId: string;
  readonly valueUsd: number;
  readonly timestamp: number;
  readonly action?: ActivityAction;
}

/** 24 hours in milliseconds. */
const WINDOW_MS = 24 * 60 * 60 * 1000;

export class InMemoryTradeWindow implements ActivityLogReader {
  private readonly entries: TradeEntry[] = [];

  /**
   * Pre-load from an existing ActivityLogReader (e.g., SQLite TradeLog).
   *
   * Called once at daemon startup to hydrate the in-memory window
   * with existing 24h trade data (swap volume, perp volume, perp withdrawals).
   */
  preload(source: ActivityLogReader, chainIds: string[]): void {
    for (const chainId of chainIds) {
      // Swap volume
      const swapVolume = source.getRolling24hVolume(chainId);
      if (swapVolume > 0) {
        this.entries.push({
          chainId,
          valueUsd: swapVolume,
          timestamp: Date.now(),
        });
      }

      // Perp volume
      const perpVolume = source.getRolling24hPerpVolume(chainId);
      if (perpVolume > 0) {
        this.entries.push({
          chainId,
          valueUsd: perpVolume,
          timestamp: Date.now(),
          action: 'perp:place_order',
        });
      }

      // Perp withdrawals
      const perpWithdraw = source.getRolling24hPerpWithdrawals(chainId);
      if (perpWithdraw > 0) {
        this.entries.push({
          chainId,
          valueUsd: perpWithdraw,
          timestamp: Date.now(),
          action: 'perp:withdraw',
        });
      }
    }
  }

  /**
   * Record a new approved trade.
   *
   * @param chainId - Chain identifier
   * @param valueUsd - USD value of the trade
   * @param action - Activity action (e.g. 'trade:swap', 'perp:place_order')
   */
  record(chainId: string, valueUsd: number, action?: ActivityAction): void {
    this.entries.push({ chainId, valueUsd, timestamp: Date.now(), action });
    this.pruneExpired();
  }

  /**
   * Get the rolling 24h approved trade volume for a chain.
   */
  getRolling24hVolume(chainId: ChainId): number {
    return this.sumByAction(chainId, 'trade:swap');
  }

  getRolling24hPerpVolume(chainId: ChainId): number {
    return this.sumByAction(chainId, 'perp:place_order');
  }

  getRolling24hPerpWithdrawals(chainId: ChainId): number {
    return this.sumByAction(chainId, 'perp:withdraw');
  }

  private sumByAction(chainId: string, action: ActivityAction): number {
    const cutoff = Date.now() - WINDOW_MS;
    let sum = 0;
    for (const e of this.entries) {
      if (e.chainId === chainId && e.action === action && e.timestamp > cutoff) {
        sum += e.valueUsd;
      }
    }
    return sum;
  }

  /** Remove entries older than 24h. */
  private pruneExpired(): void {
    const cutoff = Date.now() - WINDOW_MS;
    while (this.entries.length > 0 && (this.entries[0]?.timestamp ?? 0) <= cutoff) {
      this.entries.shift();
    }
  }
}
