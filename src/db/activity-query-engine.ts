import type Database from 'better-sqlite3';
import type {
  ActivityQueryInput,
  ActivityFilter,
  ActivityQueryResult,
} from './activity-query-tool.js';

export class QueryValidationError extends Error {
  constructor(
    message: string,
    readonly field: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'QueryValidationError';
  }
}

interface ColumnDef {
  readonly sql: string;
  readonly type: 'string' | 'number';
  readonly requiresJoin?: boolean;
}

const COLUMN_REGISTRY: Readonly<Record<string, ColumnDef>> = {
  id: { sql: 'a.id', type: 'number' },
  chain_id: { sql: 'a.chain_id', type: 'string' },
  wallet_address: { sql: 'a.wallet_address', type: 'string' },
  category: { sql: 'a.category', type: 'string' },
  action: { sql: 'a.action', type: 'string' },
  protocol: { sql: 'a.protocol', type: 'string' },
  token_a_type: { sql: 'a.token_a_type', type: 'string' },
  token_a_amount: { sql: 'a.token_a_amount', type: 'string' },
  token_b_type: { sql: 'a.token_b_type', type: 'string' },
  token_b_amount: { sql: 'a.token_b_amount', type: 'string' },
  value_usd: { sql: 'a.value_usd', type: 'number' },
  tx_digest: { sql: 'a.tx_digest', type: 'string' },
  gas_cost: { sql: 'a.gas_cost', type: 'number' },
  policy_decision: { sql: 'a.policy_decision', type: 'string' },
  rejection_reason: { sql: 'a.rejection_reason', type: 'string' },
  rejection_check: { sql: 'a.rejection_check', type: 'string' },
  metadata: { sql: 'a.metadata', type: 'string' },
  created_at: { sql: 'a.created_at', type: 'string' },
  token_a_symbol: { sql: 'cm_a.symbol', type: 'string', requiresJoin: true },
  token_a_decimals: { sql: 'cm_a.decimals', type: 'number', requiresJoin: true },
  token_b_symbol: { sql: 'cm_b.symbol', type: 'string', requiresJoin: true },
  token_b_decimals: { sql: 'cm_b.decimals', type: 'number', requiresJoin: true },
};

const ALLOWED_AGGREGATES = new Set(['SUM', 'COUNT', 'AVG', 'MIN', 'MAX']);
const NUMERIC_ONLY_AGGREGATES = new Set(['SUM', 'AVG']);
const AGG_REGEX = /^([A-Z]+)\((\*|[a-z_]+)\)$/;

const OP_MAP: Record<string, string> = {
  eq: '=',
  neq: '!=',
  gt: '>',
  lt: '<',
  gte: '>=',
  lte: '<=',
  like: 'LIKE',
};

const COIN_METADATA_JOIN = `
  LEFT JOIN coin_metadata cm_a ON cm_a.coin_type = a.token_a_type AND cm_a.chain_id = a.chain_id
  LEFT JOIN coin_metadata cm_b ON cm_b.coin_type = a.token_b_type AND cm_b.chain_id = a.chain_id`;

const DEFAULT_COLUMNS = Object.keys(COLUMN_REGISTRY).filter((k) => k !== 'metadata');
const DEFAULT_COLUMNS_NO_JOIN = DEFAULT_COLUMNS.filter(
  (k) => COLUMN_REGISTRY[k]?.requiresJoin !== true,
);

function validatedDirection(dir: string): 'ASC' | 'DESC' {
  const upper = dir.toUpperCase();
  if (upper !== 'ASC' && upper !== 'DESC') {
    throw new QueryValidationError(
      `Invalid sort direction "${dir}". Expected "asc" or "desc"`,
      'orderBy',
    );
  }
  return upper;
}

interface ParsedSelect {
  readonly sql: string;
  readonly alias: string;
  readonly isAgg: boolean;
}

function normalizeAggExpr(raw: string): string {
  const parenIdx = raw.indexOf('(');
  if (parenIdx === -1) return raw;
  const fn = raw.substring(0, parenIdx).trim().toUpperCase();
  const inner = raw.substring(parenIdx + 1, raw.lastIndexOf(')')).trim();
  return `${fn}(${inner})`;
}

function lookupColumn(name: string, field: string): ColumnDef {
  const def = COLUMN_REGISTRY[name];
  if (def === undefined) {
    throw new QueryValidationError(
      `Unknown column "${name}"`,
      field,
      `Available columns: ${Object.keys(COLUMN_REGISTRY).join(', ')}`,
    );
  }
  return def;
}

function guardJoinColumn(
  name: string,
  def: ColumnDef,
  resolveTokens: boolean,
  field: string,
): void {
  if (def.requiresJoin === true && !resolveTokens) {
    throw new QueryValidationError(
      `Column "${name}" requires resolveTokens to be true`,
      field,
      'Set resolveTokens: true or remove this column',
    );
  }
}

function resolveColumn(name: string, resolveTokens: boolean, field: string): ColumnDef {
  const def = lookupColumn(name, field);
  guardJoinColumn(name, def, resolveTokens, field);
  return def;
}

function parseAggregation(
  normalized: string,
  resolveTokens: boolean,
  field: string,
): ParsedSelect | null {
  const match = AGG_REGEX.exec(normalized);
  if (match === null) return null;

  const [, fn = '', col = ''] = match;

  if (!ALLOWED_AGGREGATES.has(fn)) {
    throw new QueryValidationError(
      `Unknown aggregation function "${fn}"`,
      field,
      `Allowed: ${[...ALLOWED_AGGREGATES].join(', ')}`,
    );
  }
  if (col !== '*') {
    const colDef = lookupColumn(col, field);
    guardJoinColumn(col, colDef, resolveTokens, field);
    if (NUMERIC_ONLY_AGGREGATES.has(fn) && colDef.type !== 'number') {
      throw new QueryValidationError(
        `${fn} requires a numeric column, but "${col}" is ${colDef.type}`,
        field,
      );
    }
    return { sql: `${fn}(${colDef.sql})`, alias: normalized, isAgg: true };
  }
  return { sql: `${fn}(*)`, alias: normalized, isAgg: true };
}

function parseSelectEntry(entry: string, resolveTokens: boolean, field: string): ParsedSelect {
  const normalized = normalizeAggExpr(entry);
  const agg = parseAggregation(normalized, resolveTokens, field);
  if (agg !== null) return agg;

  // Plain column
  const colDef = lookupColumn(entry, field);
  guardJoinColumn(entry, colDef, resolveTokens, field);
  return { sql: `${colDef.sql} AS "${entry}"`, alias: entry, isAgg: false };
}

function resolveFilterColumn(
  filter: ActivityFilter,
  resolveTokens: boolean,
  field: string,
): string {
  const normalized = normalizeAggExpr(filter.column);
  const aggMatch = AGG_REGEX.exec(normalized);

  if (aggMatch !== null) {
    const [, fn = '', col = ''] = aggMatch;
    if (!ALLOWED_AGGREGATES.has(fn)) {
      throw new QueryValidationError(`Unknown aggregation function "${fn}"`, field);
    }
    if (col === '*') {
      return `${fn}(*)`;
    }
    const colDef = resolveColumn(col, resolveTokens, field);
    return `${fn}(${colDef.sql})`;
  }

  const colDef = resolveColumn(filter.column, resolveTokens, field);
  return colDef.sql;
}

function buildFilterClause(
  filter: ActivityFilter,
  resolveTokens: boolean,
  field: string,
  params: (string | number)[],
): string {
  const sqlCol = resolveFilterColumn(filter, resolveTokens, field);

  if (filter.op === 'between') {
    if (!Array.isArray(filter.value) || filter.value.length !== 2) {
      throw new QueryValidationError(
        '"between" requires a 2-element array value',
        field,
        `Got: ${JSON.stringify(filter.value)}`,
      );
    }
    const [lo, hi] = filter.value as [string | number, string | number];
    params.push(lo, hi);
    return `${sqlCol} BETWEEN ? AND ?`;
  }

  if (filter.op === 'in') {
    if (!Array.isArray(filter.value) || filter.value.length === 0) {
      throw new QueryValidationError(
        '"in" requires a non-empty array value',
        field,
        `Got: ${JSON.stringify(filter.value)}`,
      );
    }
    const values = filter.value as readonly (string | number)[];
    const placeholders = values.map(() => '?').join(', ');
    for (const v of values) {
      params.push(v);
    }
    return `${sqlCol} IN (${placeholders})`;
  }

  const sqlOp = OP_MAP[filter.op];
  if (sqlOp === undefined) {
    throw new QueryValidationError(`Unknown operator "${filter.op}"`, field);
  }
  params.push(filter.value as string | number);
  return `${sqlCol} ${sqlOp} ?`;
}

export class ActivityQueryEngine {
  constructor(private readonly db: Database.Database) {}

  execute(input: ActivityQueryInput): ActivityQueryResult {
    const hasGroupBy = input.groupBy !== undefined && input.groupBy.length > 0;
    const resolveTokens = input.resolveTokens ?? !hasGroupBy;

    this.validateInput(input);

    const params: (string | number)[] = [];

    // SELECT
    const selectEntries =
      input.select !== undefined
        ? input.select.map((s) => parseSelectEntry(s, resolveTokens, 'select'))
        : this.buildDefaultSelect(resolveTokens);

    const selectSql = selectEntries
      .map((e) => (e.isAgg ? `${e.sql} AS "${e.alias}"` : e.sql))
      .join(', ');
    const columns = selectEntries.map((e) => e.alias);

    // FROM + JOIN
    const fromSql = resolveTokens ? `FROM activities a${COIN_METADATA_JOIN}` : 'FROM activities a';

    // WHERE
    const whereClauses: string[] = [];
    if (input.filters !== undefined) {
      for (const f of input.filters) {
        whereClauses.push(buildFilterClause(f, resolveTokens, 'filters', params));
      }
    }
    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // GROUP BY
    let groupBySql = '';
    const groupBySet = new Set<string>();
    let resolvedGroupCols: string[] = [];
    if (input.groupBy !== undefined && input.groupBy.length > 0) {
      resolvedGroupCols = input.groupBy.map((col) => {
        const def = resolveColumn(col, resolveTokens, 'groupBy');
        groupBySet.add(col);
        return def.sql;
      });
      groupBySql = `GROUP BY ${resolvedGroupCols.join(', ')}`;
    }

    // HAVING
    const havingParams: (string | number)[] = [];
    let havingSql = '';
    if (input.having !== undefined && input.having.length > 0) {
      const havingClauses: string[] = [];
      for (const h of input.having) {
        this.validateHavingColumn(h.column, groupBySet, selectEntries);
        havingClauses.push(buildFilterClause(h, resolveTokens, 'having', havingParams));
      }
      havingSql = `HAVING ${havingClauses.join(' AND ')}`;
    }

    // ORDER BY
    let orderBySql = '';
    if (input.orderBy !== undefined && input.orderBy.length > 0) {
      const orderClauses = input.orderBy.map((o) => {
        const normalized = normalizeAggExpr(o.column);
        const aggMatch = AGG_REGEX.exec(normalized);
        if (aggMatch !== null) {
          const found = selectEntries.find((e) => e.alias === normalized);
          if (found === undefined) {
            throw new QueryValidationError(
              `ORDER BY aggregation "${normalized}" must appear in select`,
              'orderBy',
            );
          }
          return `${found.sql} ${validatedDirection(o.direction)}`;
        }
        const def = resolveColumn(o.column, resolveTokens, 'orderBy');
        return `${def.sql} ${validatedDirection(o.direction)}`;
      });
      orderBySql = `ORDER BY ${orderClauses.join(', ')}`;
    }

    // LIMIT / OFFSET
    const limit = input.limit ?? 100;
    const offset = input.offset ?? 0;

    // Build data query
    const allParams = [...params, ...havingParams];
    const dataSql = [
      `SELECT ${selectSql}`,
      fromSql,
      whereSql,
      groupBySql,
      havingSql,
      orderBySql,
      `LIMIT ? OFFSET ?`,
    ]
      .filter(Boolean)
      .join(' ');

    allParams.push(limit, offset);
    const rows = this.db.prepare(dataSql).all(...allParams) as Record<string, unknown>[];

    // Build count query
    const countParams = [...params, ...havingParams];
    let countSql: string;
    if (resolvedGroupCols.length > 0) {
      countSql = [
        `SELECT COUNT(*) AS total FROM (SELECT 1`,
        fromSql,
        whereSql,
        `GROUP BY ${resolvedGroupCols.join(', ')}`,
        havingSql,
        `) AS _groups`,
      ]
        .filter(Boolean)
        .join(' ');
    } else {
      countSql = [`SELECT COUNT(*) AS total`, fromSql, whereSql].filter(Boolean).join(' ');
    }
    const countRow = this.db.prepare(countSql).get(...countParams) as { total: number } | undefined;
    const totalCount = countRow?.total ?? 0;

    return { columns, rows, totalCount };
  }

  private validateInput(input: ActivityQueryInput): void {
    if (input.limit !== undefined) {
      if (input.limit < 1) {
        throw new QueryValidationError('Limit must be >= 1', 'limit');
      }
      if (input.limit > 1000) {
        throw new QueryValidationError('Limit must be <= 1000', 'limit');
      }
    }

    if (input.offset !== undefined && input.offset < 0) {
      throw new QueryValidationError('Offset must be >= 0', 'offset');
    }
  }

  private validateHavingColumn(
    column: string,
    groupBySet: Set<string>,
    selectEntries: readonly ParsedSelect[],
  ): void {
    if (groupBySet.has(column)) return;

    const normalized = normalizeAggExpr(column);
    const aggMatch = AGG_REGEX.exec(normalized);
    if (aggMatch !== null) {
      const found = selectEntries.find((e) => e.alias === normalized);
      if (found !== undefined) return;
    }

    throw new QueryValidationError(
      `HAVING column "${column}" must be in GROUP BY or be an aggregation in SELECT`,
      'having',
    );
  }

  private buildDefaultSelect(resolveTokens: boolean): ParsedSelect[] {
    const cols = resolveTokens ? DEFAULT_COLUMNS : DEFAULT_COLUMNS_NO_JOIN;
    return cols.map((k) => {
      const def = COLUMN_REGISTRY[k];
      if (def === undefined) {
        throw new Error(`Internal error: column "${k}" missing from registry`);
      }
      return {
        sql: `${def.sql} AS "${k}"`,
        alias: k,
        isAgg: false,
      };
    });
  }
}
