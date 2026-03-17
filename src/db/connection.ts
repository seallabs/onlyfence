import Database from 'better-sqlite3';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { ONLYFENCE_DIR } from '../config/loader.js';
import { runMigrations } from './migrations.js';

/**
 * Default path to the SQLite database file.
 */
export const DB_PATH = join(ONLYFENCE_DIR, 'trades.db');

/**
 * Open (or create) the OnlyFence SQLite database and run migrations.
 *
 * @param dbPath - Path to the database file (defaults to ~/.onlyfence/trades.db)
 * @returns An open Database connection with schema applied
 * @throws Error if the database cannot be opened or migrations fail
 */
export function openDatabase(dbPath: string = DB_PATH): Database.Database {
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  runMigrations(db);

  return db;
}

/**
 * Open an in-memory SQLite database with migrations applied.
 * Useful for testing.
 *
 * @returns An open in-memory Database connection with schema applied
 */
export function openMemoryDatabase(): Database.Database {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}
