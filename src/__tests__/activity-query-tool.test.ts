import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openMemoryDatabase } from '../db/connection.js';
import { ActivityLog } from '../db/activity-log.js';
import { executeActivityQuery, getActivityQueryToolSchema } from '../db/activity-query-tool.js';
import { QueryValidationError } from '../db/activity-query-engine.js';
import { insertTestWallet, createActivityRecord } from './helpers.js';

describe('executeActivityQuery', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openMemoryDatabase();
    insertTestWallet(db);
    const log = new ActivityLog(db);
    log.logActivity(createActivityRecord({ value_usd: 100 }));
  });

  it('delegates to engine and returns result', () => {
    const result = executeActivityQuery(db, {
      filters: [{ column: 'category', op: 'eq', value: 'trade' }],
      resolveTokens: false,
    });
    expect(result.totalCount).toBe(1);
    expect(result.rows[0]!.category).toBe('trade');
  });

  it('throws QueryValidationError for bad input', () => {
    expect(() => executeActivityQuery(db, { select: ['bad_col'] })).toThrow(QueryValidationError);
  });
});

describe('getActivityQueryToolSchema', () => {
  it('returns a valid tool schema object', () => {
    const schema = getActivityQueryToolSchema();
    expect(schema.name).toBe('query_activities');
    expect(schema.description).toBeTruthy();
    expect(schema.parameters).toBeDefined();
    expect(schema.parameters.type).toBe('object');
    expect(schema.parameters.properties).toHaveProperty('select');
    expect(schema.parameters.properties).toHaveProperty('filters');
    expect(schema.parameters.properties).toHaveProperty('groupBy');
    expect(schema.parameters.properties).toHaveProperty('having');
    expect(schema.parameters.properties).toHaveProperty('orderBy');
    expect(schema.parameters.properties).toHaveProperty('limit');
    expect(schema.parameters.properties).toHaveProperty('offset');
    expect(schema.parameters.properties).toHaveProperty('resolveTokens');
  });

  it('schema is JSON-serializable', () => {
    const schema = getActivityQueryToolSchema();
    const json = JSON.stringify(schema);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed.name).toBe('query_activities');
  });
});
