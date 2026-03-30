/**
 * In-memory rolling 24h trade window for fast policy checks in the daemon.
 *
 * Implements the same interface as TradeLog for volume queries,
 * but backed by an in-memory ring buffer instead of SQLite.
 * This avoids SQLite contention and provides sub-millisecond policy checks.
 */

import type { ChainId } from '../core/action-types.js';
import type { ActivityLogReader } from '../db/activity-log.js';

interface TradeEntry {
  readonly chainId: string;
  readonly valueUsd: number;
  readonly timestamp: number;
}

/** 24 hours in milliseconds. */
const WINDOW_MS = 24 * 60 * 60 * 1000;

export class InMemoryTradeWindow implements ActivityLogReader {
  private readonly entries: TradeEntry[] = [];

  /**
   * Pre-load from an existing ActivityLogReader (e.g., SQLite TradeLog).
   *
   * Called once at daemon startup to hydrate the in-memory window
   * with existing 24h trade data.
   */
  preload(source: ActivityLogReader, chainIds: string[]): void {
    for (const chainId of chainIds) {
      const volume = source.getRolling24hVolume(chainId);
      if (volume > 0) {
        // Store as a single aggregate entry — exact trade-level granularity
        // isn't needed since we're just tracking total volume.
        this.entries.push({
          chainId,
          valueUsd: volume,
          timestamp: Date.now(),
        });
      }
    }
  }

  /**
   * Record a new approved trade.
   *
   * @param chainId - Chain identifier
   * @param valueUsd - USD value of the trade
   */
  record(chainId: string, valueUsd: number): void {
    this.entries.push({ chainId, valueUsd, timestamp: Date.now() });
    this.pruneExpired();
  }

  /**
   * Get the rolling 24h approved trade volume for a chain.
   */
  getRolling24hVolume(chainId: ChainId): number {
    const cutoff = Date.now() - WINDOW_MS;
    let total = 0;

    for (const entry of this.entries) {
      if (entry.chainId === chainId && entry.timestamp > cutoff) {
        total += entry.valueUsd;
      }
    }

    return total;
  }

  /** Remove entries older than 24h. */
  private pruneExpired(): void {
    const cutoff = Date.now() - WINDOW_MS;
    while (this.entries.length > 0 && (this.entries[0]?.timestamp ?? 0) <= cutoff) {
      this.entries.shift();
    }
  }
}
