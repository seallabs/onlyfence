import type Database from 'better-sqlite3';
import type { Statement } from 'better-sqlite3';

/**
 * A CLI event to be recorded.
 */
export interface CliEvent {
  readonly command: string;
  readonly success: boolean;
  readonly durationMs: number;
  readonly errorMessage?: string;
}

/**
 * A raw row from the cli_events table.
 */
export interface CliEventRow {
  readonly id: number;
  readonly command: string;
  readonly success: number;
  readonly duration_ms: number;
  readonly error_message: string | null;
  readonly created_at: string;
}

/**
 * Aggregated statistics for a single command.
 */
export interface CommandStat {
  readonly command: string;
  readonly count: number;
  readonly successRate: number;
  readonly avgDurationMs: number;
}

/**
 * Overall CLI usage statistics.
 */
export interface CliStats {
  readonly totalCommands: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly avgDurationMs: number;
  readonly commandBreakdown: readonly CommandStat[];
}

/**
 * Data access class for CLI usage events.
 * Follows the same cached-prepared-statement pattern as TradeLog.
 */
export class CliEventLog {
  private readonly insertStmt: Statement;
  private readonly statsStmt: Statement;
  private readonly commandStatsStmt: Statement;
  private readonly recentStmt: Statement;

  constructor(db: Database.Database) {
    this.insertStmt = db.prepare(`
      INSERT INTO cli_events (command, success, duration_ms, error_message)
      VALUES (@command, @success, @durationMs, @errorMessage)
    `);

    this.statsStmt = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes,
        COALESCE(AVG(duration_ms), 0) as avg_duration
      FROM cli_events
      WHERE created_at > datetime('now', '-' || ? || ' days')
    `);

    this.commandStatsStmt = db.prepare(`
      SELECT
        command,
        COUNT(*) as count,
        CAST(SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS REAL) / COUNT(*) as success_rate,
        COALESCE(AVG(duration_ms), 0) as avg_duration
      FROM cli_events
      WHERE created_at > datetime('now', '-' || ? || ' days')
      GROUP BY command
      ORDER BY count DESC
    `);

    this.recentStmt = db.prepare(`
      SELECT * FROM cli_events
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `);
  }

  /**
   * Record a CLI event.
   *
   * @returns The inserted row ID
   */
  recordEvent(event: CliEvent): number {
    const result = this.insertStmt.run({
      command: event.command,
      success: event.success ? 1 : 0,
      durationMs: event.durationMs,
      errorMessage: event.errorMessage ?? null,
    });
    return Number(result.lastInsertRowid);
  }

  /**
   * Get aggregated usage statistics for the last N days.
   */
  getStats(sinceDays = 30): CliStats {
    const overview = this.statsStmt.get(sinceDays) as {
      total: number;
      successes: number;
      avg_duration: number;
    };

    const breakdown = this.commandStatsStmt.all(sinceDays) as {
      command: string;
      count: number;
      success_rate: number;
      avg_duration: number;
    }[];

    return {
      totalCommands: overview.total,
      successCount: overview.successes,
      failureCount: overview.total - overview.successes,
      avgDurationMs: Math.round(overview.avg_duration),
      commandBreakdown: breakdown.map((row) => ({
        command: row.command,
        count: row.count,
        successRate: row.success_rate,
        avgDurationMs: Math.round(row.avg_duration),
      })),
    };
  }

  /**
   * Get recent CLI events for inspection.
   */
  getRecentEvents(limit: number, offset = 0): CliEventRow[] {
    return this.recentStmt.all(limit, offset) as CliEventRow[];
  }
}
