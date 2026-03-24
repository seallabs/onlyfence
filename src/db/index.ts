export type { ActivityRecord, ActivityRow } from './activity-log.js';
export type { ActivityAction, ActivityCategory } from '../core/action-types.js';
export { ActivityLog } from './activity-log.js';
export type { CliEvent, CliEventRow, CliStats, CommandStat } from './cli-events.js';
export { CliEventLog } from './cli-events.js';
export { DB_PATH, openDatabase, openMemoryDatabase } from './connection.js';
export { runMigrations } from './migrations.js';
export { ActivityQueryEngine, QueryValidationError } from './activity-query-engine.js';
export {
  executeActivityQuery,
  getActivityQueryToolSchema,
  type ActivityQueryInput,
  type ActivityFilter,
  type ActivityOrderBy,
  type ActivityQueryResult,
} from './activity-query-tool.js';
