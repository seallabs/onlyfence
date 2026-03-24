import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { ONLYFENCE_DIR } from '../config/loader.js';
import {
  SECURE_DIR_MODE,
  SECURE_FILE_MODE,
  enforceFilePermissions,
} from '../security/file-permissions.js';
import type { UpdateCache } from '../types/update.js';

/**
 * Default path to the update cache file.
 */
export const UPDATE_CACHE_PATH = join(ONLYFENCE_DIR, 'update-check.json');

/**
 * Default time-to-live for the cache: 24 hours.
 */
export const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Interface for reading and writing the version check cache.
 *
 * Implementations must guarantee that `read()` never throws —
 * a missing or corrupt cache is a degraded state, not an error.
 */
export interface UpdateCacheService {
  /** Read the cached update info. Returns null if absent or invalid. */
  read(): UpdateCache | null;

  /** Write a new cache entry. Throws on I/O failure. */
  write(cache: UpdateCache): void;

  /** Check whether the cache entry is older than `ttlMs`. */
  isStale(cache: UpdateCache, ttlMs?: number): boolean;
}

/**
 * File-backed update cache stored at ~/.onlyfence/update-check.json.
 *
 * `read()` never throws — returns null on any failure (missing file, corrupt JSON,
 * invalid shape). This is the only justified silent failure: a missing/corrupt cache
 * is a degraded state, not an error.
 *
 * `write()` uses atomic tmp + rename to prevent corruption from concurrent writers
 * (e.g., the background check process and a manual `fence update` at the same time).
 */
export class FileUpdateCacheService implements UpdateCacheService {
  private readonly cachePath: string;

  constructor(cachePath: string = UPDATE_CACHE_PATH) {
    this.cachePath = cachePath;
  }

  read(): UpdateCache | null {
    try {
      const content = readFileSync(this.cachePath, 'utf-8');
      const parsed: unknown = JSON.parse(content);

      if (!isValidCache(parsed)) {
        return null;
      }

      return parsed;
    } catch {
      return null;
    }
  }

  write(cache: UpdateCache): void {
    const tmpPath = `${this.cachePath}.tmp`;
    const data = JSON.stringify(cache, null, 2);

    try {
      writeFileSync(tmpPath, data, 'utf-8');
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // Directory doesn't exist yet (first run) — create and retry.
        mkdirSync(dirname(this.cachePath), { recursive: true, mode: SECURE_DIR_MODE });
        writeFileSync(tmpPath, data, 'utf-8');
      } else {
        throw err;
      }
    }

    renameSync(tmpPath, this.cachePath);
    enforceFilePermissions(this.cachePath, SECURE_FILE_MODE);
  }

  isStale(cache: UpdateCache, ttlMs: number = DEFAULT_CACHE_TTL_MS): boolean {
    const checkedAt = new Date(cache.checkedAt).getTime();

    if (Number.isNaN(checkedAt)) {
      return true;
    }

    return Date.now() - checkedAt > ttlMs;
  }
}

/**
 * Validate that a parsed JSON value has the required UpdateCache shape.
 */
function isValidCache(value: unknown): value is UpdateCache {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record['checkedAt'] === 'string' &&
    record['checkedAt'].length > 0 &&
    typeof record['latestVersion'] === 'string' &&
    record['latestVersion'].length > 0 &&
    typeof record['currentVersion'] === 'string' &&
    record['currentVersion'].length > 0
  );
}
