import type { UpdateStatus } from '../types/update.js';
import type { UpdateSource } from './source.js';
import type { UpdateCacheService } from './cache.js';
import { hasLogger, getLogger } from '../logger/index.js';

/**
 * Interface for checking whether an update is available.
 *
 * Two modes:
 * - `checkFromCache`: synchronous, reads only the local cache (~1ms)
 * - `checkFromSource`: async, fetches from the remote source and updates cache
 */
export interface UpdateChecker {
  /** Synchronous: read cache and return status immediately (~1ms). */
  checkFromCache(currentVersion: string): UpdateStatus;

  /** Async: fetch from source, update cache, return status. */
  checkFromSource(currentVersion: string): Promise<UpdateStatus>;
}

/**
 * Default implementation composing an UpdateSource with an UpdateCacheService.
 */
export class DefaultUpdateChecker implements UpdateChecker {
  private readonly source: UpdateSource;
  private readonly cache: UpdateCacheService;

  constructor(source: UpdateSource, cache: UpdateCacheService) {
    this.source = source;
    this.cache = cache;
  }

  checkFromCache(currentVersion: string): UpdateStatus {
    const cached = this.cache.read();

    if (cached === null || this.cache.isStale(cached)) {
      return { kind: 'unknown' };
    }

    return resolveStatus(currentVersion, cached.latestVersion);
  }

  async checkFromSource(currentVersion: string): Promise<UpdateStatus> {
    const latestVersion = await this.source.fetchLatestVersion();

    try {
      this.cache.write({
        checkedAt: new Date().toISOString(),
        latestVersion,
        currentVersion,
      });
    } catch (err: unknown) {
      // Cache write failure should not prevent reporting the version check result.
      if (hasLogger()) {
        getLogger().warn({ err }, 'Failed to write update cache');
      }
    }

    return resolveStatus(currentVersion, latestVersion);
  }
}

/**
 * Compare two semver version strings (MAJOR.MINOR.PATCH).
 *
 * @returns negative if a < b, 0 if equal, positive if a > b
 * @throws Error if either version is not a valid MAJOR.MINOR.PATCH triple
 */
export function compareVersions(a: string, b: string): number {
  const [aMajor, aMinor, aPatch] = parseSemver(a);
  const [bMajor, bMinor, bPatch] = parseSemver(b);

  if (aMajor !== bMajor) return aMajor - bMajor;
  if (aMinor !== bMinor) return aMinor - bMinor;
  return aPatch - bPatch;
}

/**
 * Parse a version string into [major, minor, patch].
 */
function parseSemver(version: string): [number, number, number] {
  const parts = version.split('.');

  if (parts.length !== 3) {
    throw new Error(`Invalid version format: "${version}" — expected MAJOR.MINOR.PATCH`);
  }

  const major = parseSegment(parts[0], version);
  const minor = parseSegment(parts[1], version);
  const patch = parseSegment(parts[2], version);

  return [major, minor, patch];
}

function parseSegment(segment: string | undefined, version: string): number {
  if (segment === undefined) {
    throw new Error(`Invalid version format: "${version}" — expected MAJOR.MINOR.PATCH`);
  }
  const n = parseInt(segment, 10);
  if (Number.isNaN(n) || n < 0) {
    throw new Error(`Invalid version segment "${segment}" in "${version}"`);
  }
  return n;
}

/**
 * Resolve an UpdateStatus from current and latest version strings.
 */
function resolveStatus(currentVersion: string, latestVersion: string): UpdateStatus {
  const cmp = compareVersions(currentVersion, latestVersion);

  if (cmp >= 0) {
    return { kind: 'up-to-date' };
  }

  return {
    kind: 'update-available',
    latestVersion,
    currentVersion,
  };
}
