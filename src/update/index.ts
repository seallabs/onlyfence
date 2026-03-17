import { GitHubReleasesSource } from './github-source.js';
import { FileUpdateCacheService } from './cache.js';
import { DefaultUpdateChecker } from './checker.js';
import { ShellUpdateInstaller } from './installer.js';

// Source
export type { UpdateSource } from './source.js';
export { UpdateSourceError, GITHUB_REPO } from './source.js';
export { GitHubReleasesSource } from './github-source.js';

// Cache
export type { UpdateCacheService } from './cache.js';
export { FileUpdateCacheService, UPDATE_CACHE_PATH, DEFAULT_CACHE_TTL_MS } from './cache.js';

// Checker
export type { UpdateChecker } from './checker.js';
export { DefaultUpdateChecker, compareVersions } from './checker.js';

// Installer
export type { UpdateInstaller } from './installer.js';
export { ShellUpdateInstaller, InstallError } from './installer.js';

// CLI hook
export { registerUpdateCheckHook, isBackgroundCheckProcess, BG_CHECK_FLAG } from './cli-hook.js';

// Background worker
export { runBackgroundCheck } from './fetch-worker.js';

// Version — auto-generated from package.json by scripts/sync-version.js
export { CURRENT_VERSION } from './version.js';

/**
 * Construct the default production update checker.
 *
 * Wires GitHubReleasesSource + FileUpdateCacheService.
 */
export function createUpdateChecker(): DefaultUpdateChecker {
  return new DefaultUpdateChecker(new GitHubReleasesSource(), new FileUpdateCacheService());
}

/**
 * Construct the default production installer.
 */
export function createUpdateInstaller(): ShellUpdateInstaller {
  return new ShellUpdateInstaller();
}
