import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { ActivityQueryEngine, QueryValidationError } from '../db/activity-query-engine.js';
import { openMemoryDatabase } from '../db/connection.js';
import { ActivityLog } from '../db/activity-log.js';
import type { ActivityQueryInput } from '../db/activity-query-tool.js';
import { insertTestWallet, createActivityRecord, createLendingActivityRecord } from './helpers.js';

describe('QueryValidationError', () => {
  it('exposes field and detail properties', () => {
    const err = new QueryValidationError('bad column', 'select', 'column "foo" not found');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('bad column');
    expect(err.field).toBe('select');
    expect(err.detail).toBe('column "foo" not found');
  });

  it('has optional detail', () => {
    const err = new QueryValidationError('bad limit', 'limit');
    expect(err.detail).toBeUndefined();
  });
});

describe('ActivityQueryEngine validation', () => {
  let engine: ActivityQueryEngine;

  beforeEach(() => {
    const db = openMemoryDatabase();
    engine = new ActivityQueryEngine(db);
  });

  it('rejects unknown column in select', () => {
    const input: ActivityQueryInput = { select: ['nonexistent'] };
    expect(() => engine.execute(input)).toThrow(QueryValidationError);
  });

  it('rejects unknown column in filters', () => {
    const input: ActivityQueryInput = {
      filters: [{ column: 'bad_col', op: 'eq', value: 'x' }],
    };
    expect(() => engine.execute(input)).toThrow(QueryValidationError);
  });

  it('rejects join column when resolveTokens is false', () => {
    const input: ActivityQueryInput = {
      select: ['token_a_symbol'],
      resolveTokens: false,
    };
    expect(() => engine.execute(input)).toThrow(QueryValidationError);
  });

  it('rejects SUM on string column', () => {
    const input: ActivityQueryInput = {
      select: ['SUM(action)'],
    };
    expect(() => engine.execute(input)).toThrow(QueryValidationError);
  });

  it('rejects AVG on string column', () => {
    const input: ActivityQueryInput = { select: ['AVG(action)'] };
    expect(() => engine.execute(input)).toThrow(QueryValidationError);
  });

  it('rejects unknown aggregation function', () => {
    const input: ActivityQueryInput = {
      select: ['MEDIAN(value_usd)'],
    };
    expect(() => engine.execute(input)).toThrow(QueryValidationError);
  });

  it('accepts COUNT(*)', () => {
    const input: ActivityQueryInput = {
      select: ['COUNT(*)'],
      resolveTokens: false,
    };
    expect(() => engine.execute(input)).not.toThrow();
  });

  it('rejects limit > 1000', () => {
    const input: ActivityQueryInput = { limit: 1001 };
    expect(() => engine.execute(input)).toThrow(QueryValidationError);
  });

  it('rejects limit < 1', () => {
    const input: ActivityQueryInput = { limit: 0 };
    expect(() => engine.execute(input)).toThrow(QueryValidationError);
  });

  it('rejects negative offset', () => {
    const input: ActivityQueryInput = { offset: -1 };
    expect(() => engine.execute(input)).toThrow(QueryValidationError);
  });

  it('rejects between with non-2-element array', () => {
    const input: ActivityQueryInput = {
      filters: [{ column: 'value_usd', op: 'between', value: [1] }],
    };
    expect(() => engine.execute(input)).toThrow(QueryValidationError);
  });

  it('rejects in with empty array', () => {
    const input: ActivityQueryInput = {
      filters: [{ column: 'category', op: 'in', value: [] }],
    };
    expect(() => engine.execute(input)).toThrow(QueryValidationError);
  });

  it('rejects HAVING filter on non-grouped non-aggregate column', () => {
    const input: ActivityQueryInput = {
      select: ['category', 'COUNT(*)'],
      groupBy: ['category'],
      having: [{ column: 'value_usd', op: 'gt', value: 100 }],
      resolveTokens: false,
    };
    expect(() => engine.execute(input)).toThrow(QueryValidationError);
  });

  it('allows HAVING filter on grouped column', () => {
    const input: ActivityQueryInput = {
      select: ['category', 'COUNT(*)'],
      groupBy: ['category'],
      having: [{ column: 'category', op: 'neq', value: 'trade' }],
      resolveTokens: false,
    };
    expect(() => engine.execute(input)).not.toThrow();
  });

  it('normalizes and accepts lowercase aggregation with whitespace', () => {
    const input: ActivityQueryInput = {
      select: ['sum( value_usd )'],
      resolveTokens: false,
    };
    expect(() => engine.execute(input)).not.toThrow();
  });

  it('rejects orderBy aggregation not in select', () => {
    const input: ActivityQueryInput = {
      select: ['category', 'COUNT(*)'],
      groupBy: ['category'],
      orderBy: [{ column: 'SUM(value_usd)', direction: 'desc' }],
      resolveTokens: false,
    };
    expect(() => engine.execute(input)).toThrow(QueryValidationError);
  });
});

function seedActivities(db: Database.Database): void {
  insertTestWallet(db);
  const log = new ActivityLog(db);
  log.logActivity(
    createActivityRecord({
      value_usd: 98.0,
      tx_digest: '0xd1',
      gas_cost: 0.002,
    }),
  );
  log.logActivity(
    createLendingActivityRecord({
      token_a_amount: '500000000',
      value_usd: 500.0,
      tx_digest: '0xd2',
      gas_cost: 0.001,
    }),
  );
  log.logActivity(
    createActivityRecord({
      token_a_type: '0xusdc::usdc::USDC',
      token_a_amount: '50000000',
      token_b_type: undefined,
      token_b_amount: undefined,
      value_usd: 50.0,
      tx_digest: undefined,
      gas_cost: undefined,
      policy_decision: 'rejected',
      rejection_reason: 'Exceeds limit',
      rejection_check: 'SpendingLimitCheck',
    }),
  );
}

describe('ActivityQueryEngine execution', () => {
  let db: Database.Database;
  let engine: ActivityQueryEngine;

  beforeEach(() => {
    db = openMemoryDatabase();
    seedActivities(db);
    engine = new ActivityQueryEngine(db);
  });

  it('returns all activities with default select', () => {
    const result = engine.execute({});
    expect(result.totalCount).toBe(3);
    expect(result.rows).toHaveLength(3);
    expect(result.columns).toContain('id');
    expect(result.columns).toContain('action');
    expect(result.columns).not.toContain('metadata');
  });

  it('filters by eq operator', () => {
    const result = engine.execute({
      filters: [{ column: 'policy_decision', op: 'eq', value: 'approved' }],
      resolveTokens: false,
    });
    expect(result.totalCount).toBe(2);
    expect(result.rows.every((r) => r.policy_decision === 'approved')).toBe(true);
  });

  it('filters by neq operator', () => {
    const result = engine.execute({
      filters: [{ column: 'policy_decision', op: 'neq', value: 'rejected' }],
      resolveTokens: false,
    });
    expect(result.totalCount).toBe(2);
    expect(result.rows.every((r) => r.policy_decision !== 'rejected')).toBe(true);
  });

  it('filters by gt operator on numeric column', () => {
    const result = engine.execute({
      filters: [{ column: 'value_usd', op: 'gt', value: 90 }],
      resolveTokens: false,
    });
    expect(result.rows.every((r) => (r.value_usd as number) > 90)).toBe(true);
  });

  it('filters by gte operator (boundary inclusive)', () => {
    const result = engine.execute({
      filters: [{ column: 'value_usd', op: 'gte', value: 98 }],
      resolveTokens: false,
    });
    expect(result.rows.every((r) => (r.value_usd as number) >= 98)).toBe(true);
    expect(result.totalCount).toBe(2);
  });

  it('filters by lte operator (boundary inclusive)', () => {
    const result = engine.execute({
      filters: [{ column: 'value_usd', op: 'lte', value: 50 }],
      resolveTokens: false,
    });
    expect(result.rows.every((r) => (r.value_usd as number) <= 50)).toBe(true);
    expect(result.totalCount).toBe(1);
  });

  it('filters by in operator', () => {
    const result = engine.execute({
      filters: [{ column: 'category', op: 'in', value: ['trade', 'lending'] }],
      resolveTokens: false,
    });
    expect(result.totalCount).toBe(3);
  });

  it('filters by like operator', () => {
    const result = engine.execute({
      filters: [{ column: 'action', op: 'like', value: 'trade:%' }],
      resolveTokens: false,
    });
    expect(result.rows.every((r) => (r.action as string).startsWith('trade:'))).toBe(true);
    expect(result.totalCount).toBe(2);
  });

  it('filters by between operator', () => {
    const result = engine.execute({
      filters: [{ column: 'value_usd', op: 'between', value: [50, 100] }],
      resolveTokens: false,
    });
    expect(
      result.rows.every((r) => {
        const v = r.value_usd as number;
        return v >= 50 && v <= 100;
      }),
    ).toBe(true);
    expect(result.totalCount).toBe(2);
  });

  it('selects specific columns', () => {
    const result = engine.execute({
      select: ['action', 'value_usd'],
      resolveTokens: false,
    });
    expect(result.columns).toEqual(['action', 'value_usd']);
    expect(Object.keys(result.rows[0] as Record<string, unknown>)).toEqual(['action', 'value_usd']);
  });

  it('supports GROUP BY with aggregation', () => {
    const result = engine.execute({
      select: ['category', 'COUNT(*)', 'SUM(value_usd)'],
      groupBy: ['category'],
      resolveTokens: false,
    });
    expect(result.columns).toEqual(['category', 'COUNT(*)', 'SUM(value_usd)']);
    const trade = result.rows.find((r) => r.category === 'trade');
    expect(trade).toBeDefined();
    expect(trade!['COUNT(*)']).toBe(2);
    expect(trade!['SUM(value_usd)']).toBe(148.0);
  });

  it('supports HAVING on aggregation', () => {
    const result = engine.execute({
      select: ['category', 'SUM(value_usd)'],
      groupBy: ['category'],
      having: [{ column: 'SUM(value_usd)', op: 'gt', value: 200 }],
      resolveTokens: false,
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.category).toBe('lending');
  });

  it('supports ORDER BY column', () => {
    const result = engine.execute({
      select: ['action', 'value_usd'],
      orderBy: [{ column: 'value_usd', direction: 'asc' }],
      resolveTokens: false,
    });
    const values = result.rows.map((r) => r.value_usd as number);
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });

  it('supports ORDER BY aggregation', () => {
    const result = engine.execute({
      select: ['category', 'SUM(value_usd)'],
      groupBy: ['category'],
      orderBy: [{ column: 'SUM(value_usd)', direction: 'desc' }],
      resolveTokens: false,
    });
    expect(result.rows[0]!.category).toBe('lending');
  });

  it('respects limit and offset', () => {
    const page1 = engine.execute({ limit: 1, offset: 0, resolveTokens: false });
    const page2 = engine.execute({ limit: 1, offset: 1, resolveTokens: false });
    expect(page1.rows).toHaveLength(1);
    expect(page2.rows).toHaveLength(1);
    expect(page1.rows[0]!.id).not.toBe(page2.rows[0]!.id);
    expect(page1.totalCount).toBe(3);
  });

  it('defaults resolveTokens to true for non-grouped queries', () => {
    const result = engine.execute({});
    expect(result.columns).toContain('token_a_symbol');
  });

  it('defaults resolveTokens to false for grouped queries', () => {
    const result = engine.execute({
      select: ['category', 'COUNT(*)'],
      groupBy: ['category'],
    });
    expect(result.columns).not.toContain('token_a_symbol');
  });

  it('allows explicit resolveTokens: true with groupBy', () => {
    const result = engine.execute({
      select: ['category', 'COUNT(*)'],
      groupBy: ['category'],
      resolveTokens: true,
    });
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it('returns totalCount as number of groups when GROUP BY is used', () => {
    const result = engine.execute({
      select: ['category', 'COUNT(*)'],
      groupBy: ['category'],
      resolveTokens: false,
    });
    expect(result.totalCount).toBe(2);
  });

  it('totalCount reflects total groups while rows reflect page for grouped+paginated queries', () => {
    const result = engine.execute({
      select: ['category', 'COUNT(*)'],
      groupBy: ['category'],
      limit: 1,
      offset: 0,
      resolveTokens: false,
    });
    expect(result.rows).toHaveLength(1);
    expect(result.totalCount).toBe(2);
  });

  it('normalizes aggregation aliases (whitespace + case)', () => {
    const result = engine.execute({
      select: ['category', 'sum( value_usd )'],
      groupBy: ['category'],
      resolveTokens: false,
    });
    expect(result.columns).toContain('SUM(value_usd)');
  });

  it('returns empty rows for no matches', () => {
    const result = engine.execute({
      filters: [{ column: 'category', op: 'eq', value: 'staking' }],
      resolveTokens: false,
    });
    expect(result.rows).toEqual([]);
    expect(result.totalCount).toBe(0);
  });
});
