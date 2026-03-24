import type Database from 'better-sqlite3';
import { ActivityQueryEngine } from './activity-query-engine.js';

export interface ActivityQueryInput {
  readonly select?: readonly string[];
  readonly filters?: readonly ActivityFilter[];
  readonly groupBy?: readonly string[];
  readonly having?: readonly ActivityFilter[];
  readonly orderBy?: readonly ActivityOrderBy[];
  readonly limit?: number;
  readonly offset?: number;
  readonly resolveTokens?: boolean;
}

export interface ActivityFilter {
  readonly column: string;
  readonly op: 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'in' | 'like' | 'between';
  readonly value: string | number | readonly (string | number)[];
}

export interface ActivityOrderBy {
  readonly column: string;
  readonly direction: 'asc' | 'desc';
}

export interface ActivityQueryResult {
  readonly columns: string[];
  readonly rows: Record<string, unknown>[];
  readonly totalCount: number;
}

type ToolSchemaProperties = Readonly<Record<string, Record<string, unknown>>>;

interface ToolSchema {
  readonly name: string;
  readonly description: string;
  readonly parameters: {
    readonly type: string;
    readonly properties: ToolSchemaProperties;
  };
}

export function executeActivityQuery(
  db: Database.Database,
  input: ActivityQueryInput,
): ActivityQueryResult {
  const engine = new ActivityQueryEngine(db);
  return engine.execute(input);
}

export function getActivityQueryToolSchema(): ToolSchema {
  return {
    name: 'query_activities',
    description:
      'Query the activities database with flexible filtering, aggregation, sorting, and grouping. Supports all DeFi activity types (trades, lending, LP, perp, staking). Returns rows with optional token metadata resolution.',
    parameters: {
      type: 'object',
      properties: {
        select: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Columns or aggregations to select. Aggregations: SUM(col), COUNT(*), AVG(col), MIN(col), MAX(col). Default: all columns except metadata.',
        },
        filters: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              column: { type: 'string' },
              op: {
                type: 'string',
                enum: ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'in', 'like', 'between'],
              },
              value: {
                oneOf: [
                  { type: 'string' },
                  { type: 'number' },
                  { type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'number' }] } },
                ],
              },
            },
            required: ['column', 'op', 'value'],
          },
          description: 'WHERE filters. Use concrete ISO timestamps for date comparisons.',
        },
        groupBy: {
          type: 'array',
          items: { type: 'string' },
          description: 'Columns to GROUP BY.',
        },
        having: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              column: { type: 'string' },
              op: {
                type: 'string',
                enum: ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'in', 'like', 'between'],
              },
              value: {
                oneOf: [
                  { type: 'string' },
                  { type: 'number' },
                  { type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'number' }] } },
                ],
              },
            },
            required: ['column', 'op', 'value'],
          },
          description: 'HAVING filters. Must reference grouped columns or aggregations.',
        },
        orderBy: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              column: { type: 'string' },
              direction: { type: 'string', enum: ['asc', 'desc'] },
            },
            required: ['column', 'direction'],
          },
          description: 'ORDER BY clauses. Column can be a plain column or aggregation from select.',
        },
        limit: {
          type: 'number',
          description: 'Max rows to return (1-1000, default 100).',
        },
        offset: {
          type: 'number',
          description: 'Rows to skip (default 0).',
        },
        resolveTokens: {
          type: 'boolean',
          description:
            'Join coin_metadata for token symbols/decimals. Default: true for row queries, false for grouped queries.',
        },
      },
    },
  };
}
