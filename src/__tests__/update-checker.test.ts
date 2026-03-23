import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { UpdateCache } from '../types/update.js';
import { FileUpdateCacheService } from '../update/cache.js';
import { compareVersions, DefaultUpdateChecker } from '../update/checker.js';
import type { UpdateSource } from '../update/source.js';

// --- compareVersions ---

describe('compareVersions', () => {
  it('should return 0 for equal versions', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0);
  });

  it('should return negative when a < b', () => {
    expect(compareVersions('0.1.0', '0.2.0')).toBeLessThan(0);
    expect(compareVersions('0.1.0', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('1.2.3', '1.2.4')).toBeLessThan(0);
  });

  it('should return positive when a > b', () => {
    expect(compareVersions('0.2.0', '0.1.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0);
  });

  it('should compare major before minor before patch', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.2.0', '1.1.9')).toBeGreaterThan(0);
  });

  it('should throw for invalid version format', () => {
    expect(() => compareVersions('1.0', '1.0.0')).toThrow('Invalid version format');
    expect(() => compareVersions('abc', '1.0.0')).toThrow('Invalid version format');
    expect(() => compareVersions('1.0.0.0', '1.0.0')).toThrow('Invalid version format');
    expect(() => compareVersions('1.-1.0', '1.0.0')).toThrow('Invalid version segment');
  });
});

// --- FileUpdateCacheService ---

describe('FileUpdateCacheService', () => {
  let testDir: string;
  let cachePath: string;
  let service: FileUpdateCacheService;

  beforeEach(() => {
    testDir = join(tmpdir(), `onlyfence-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    cachePath = join(testDir, 'update-check.json');
    service = new FileUpdateCacheService(cachePath);
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Cleanup best-effort
    }
  });

  it('should return null when cache file does not exist', () => {
    expect(service.read()).toBeNull();
  });

  it('should return null for corrupt JSON', () => {
    writeFileSync(cachePath, 'not json', 'utf-8');
    expect(service.read()).toBeNull();
  });

  it('should return null for invalid cache shape', () => {
    writeFileSync(cachePath, JSON.stringify({ foo: 'bar' }), 'utf-8');
    expect(service.read()).toBeNull();
  });

  it('should return null for empty strings in cache', () => {
    writeFileSync(
      cachePath,
      JSON.stringify({
        checkedAt: '',
        latestVersion: '0.1.0',
        currentVersion: '0.1.0',
      }),
      'utf-8',
    );
    expect(service.read()).toBeNull();
  });

  it('should write and read cache correctly', () => {
    const cache: UpdateCache = {
      checkedAt: new Date().toISOString(),
      latestVersion: '0.2.0',
      currentVersion: '0.1.0',
    };

    service.write(cache);
    const result = service.read();

    expect(result).toEqual(cache);
  });

  it('should detect stale cache', () => {
    const staleCache: UpdateCache = {
      checkedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      latestVersion: '0.2.0',
      currentVersion: '0.1.0',
    };

    expect(service.isStale(staleCache)).toBe(true);
  });

  it('should detect fresh cache', () => {
    const freshCache: UpdateCache = {
      checkedAt: new Date().toISOString(),
      latestVersion: '0.2.0',
      currentVersion: '0.1.0',
    };

    expect(service.isStale(freshCache)).toBe(false);
  });

  it('should treat invalid date as stale', () => {
    const badCache: UpdateCache = {
      checkedAt: 'not-a-date',
      latestVersion: '0.2.0',
      currentVersion: '0.1.0',
    };

    expect(service.isStale(badCache)).toBe(true);
  });

  it('should support custom TTL', () => {
    const cache: UpdateCache = {
      checkedAt: new Date(Date.now() - 5000).toISOString(),
      latestVersion: '0.2.0',
      currentVersion: '0.1.0',
    };

    expect(service.isStale(cache, 3000)).toBe(true);
    expect(service.isStale(cache, 10_000)).toBe(false);
  });
});

// --- DefaultUpdateChecker ---

describe('DefaultUpdateChecker', () => {
  function createMockSource(version: string): UpdateSource {
    return {
      async fetchLatestVersion(): Promise<string> {
        return version;
      },
    };
  }

  function createFailingSource(error: Error): UpdateSource {
    return {
      async fetchLatestVersion(): Promise<string> {
        throw error;
      },
    };
  }

  let testDir: string;
  let cachePath: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `onlyfence-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    cachePath = join(testDir, 'update-check.json');
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Cleanup best-effort
    }
  });

  it('should return unknown when cache is empty', () => {
    const cache = new FileUpdateCacheService(cachePath);
    const checker = new DefaultUpdateChecker(createMockSource('0.2.0'), cache);

    expect(checker.checkFromCache('0.1.0')).toEqual({ kind: 'unknown' });
  });

  it('should return up-to-date from cache', () => {
    const cache = new FileUpdateCacheService(cachePath);
    cache.write({
      checkedAt: new Date().toISOString(),
      latestVersion: '0.1.0',
      currentVersion: '0.1.0',
    });

    const checker = new DefaultUpdateChecker(createMockSource('0.1.0'), cache);
    expect(checker.checkFromCache('0.1.0')).toEqual({ kind: 'up-to-date' });
  });

  it('should return update-available from cache', () => {
    const cache = new FileUpdateCacheService(cachePath);
    cache.write({
      checkedAt: new Date().toISOString(),
      latestVersion: '0.2.0',
      currentVersion: '0.1.0',
    });

    const checker = new DefaultUpdateChecker(createMockSource('0.2.0'), cache);
    expect(checker.checkFromCache('0.1.0')).toEqual({
      kind: 'update-available',
      latestVersion: '0.2.0',
      currentVersion: '0.1.0',
    });
  });

  it('should return unknown for stale cache', () => {
    const cache = new FileUpdateCacheService(cachePath);
    cache.write({
      checkedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      latestVersion: '0.2.0',
      currentVersion: '0.1.0',
    });

    const checker = new DefaultUpdateChecker(createMockSource('0.2.0'), cache);
    expect(checker.checkFromCache('0.1.0')).toEqual({ kind: 'unknown' });
  });

  it('should fetch from source and update cache', async () => {
    const cache = new FileUpdateCacheService(cachePath);
    const checker = new DefaultUpdateChecker(createMockSource('0.3.0'), cache);

    const status = await checker.checkFromSource('0.1.0');

    expect(status).toEqual({
      kind: 'update-available',
      latestVersion: '0.3.0',
      currentVersion: '0.1.0',
    });

    // Cache should be updated
    const cached = cache.read();
    expect(cached).not.toBeNull();
    expect(cached?.latestVersion).toBe('0.3.0');
  });

  it('should return up-to-date when source matches current', async () => {
    const cache = new FileUpdateCacheService(cachePath);
    const checker = new DefaultUpdateChecker(createMockSource('0.1.0'), cache);

    const status = await checker.checkFromSource('0.1.0');
    expect(status).toEqual({ kind: 'up-to-date' });
  });

  it('should return up-to-date when current is newer than source', async () => {
    const cache = new FileUpdateCacheService(cachePath);
    const checker = new DefaultUpdateChecker(createMockSource('0.0.9'), cache);

    const status = await checker.checkFromSource('0.1.0');
    expect(status).toEqual({ kind: 'up-to-date' });
  });

  it('should propagate source errors', async () => {
    const cache = new FileUpdateCacheService(cachePath);
    const checker = new DefaultUpdateChecker(
      createFailingSource(new Error('network error')),
      cache,
    );

    await expect(checker.checkFromSource('0.1.0')).rejects.toThrow('network error');
  });
});
