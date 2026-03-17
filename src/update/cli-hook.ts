import { spawn } from 'node:child_process';
import type { Command } from 'commander';
import type { UpdateChecker } from './checker.js';
import { hasLogger, getLogger } from '../logger/index.js';

/**
 * Hidden CLI flag used to invoke the background update check.
 * This is an internal implementation detail — not visible in --help.
 */
export const BG_CHECK_FLAG = '--_update-check-bg';

/**
 * Check whether the current process was spawned as a background update check.
 */
export function isBackgroundCheckProcess(): boolean {
  return process.argv.includes(BG_CHECK_FLAG);
}

/**
 * Register a Commander.js preAction hook that performs a non-blocking
 * update check on every CLI invocation.
 *
 * The hook is strictly synchronous from the parent process perspective:
 * 1. Read the local cache file (~1ms)
 * 2. If an update is available, print a one-line notice to stderr
 * 3. If the cache is stale/absent, spawn a detached child process
 *    that fetches the latest version and updates the cache
 *
 * The parent process never awaits the child. Total overhead: ~1ms when
 * cache is fresh, ~10ms when a background spawn is needed (once per 24h).
 *
 * @param program - Root Commander program instance
 * @param checker - UpdateChecker for cache reads
 * @param currentVersion - The currently running version
 */
export function registerUpdateCheckHook(
  program: Command,
  checker: UpdateChecker,
  currentVersion: string,
): void {
  let executed = false;

  program.hook('preAction', () => {
    if (executed) {
      return;
    }
    executed = true;

    const status = checker.checkFromCache(currentVersion);

    if (status.kind === 'update-available') {
      process.stderr.write(
        `\nOnlyFence v${status.latestVersion} is available (current: v${currentVersion}). Run "fence update" to install.\n\n`,
      );
    }

    if (status.kind === 'unknown') {
      spawnBackgroundCheck();
    }
  });
}

/**
 * Spawn a detached child process to fetch the latest version and update the cache.
 *
 * The child re-invokes the CLI entry point with the hidden --_update-check-bg flag.
 * It is fully detached: the parent does not wait for it, and it writes no output.
 */
function spawnBackgroundCheck(): void {
  try {
    const entryScript = process.argv[1];
    if (entryScript === undefined) return;
    const child = spawn(process.execPath, [entryScript, BG_CHECK_FLAG], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch (err: unknown) {
    // Background check is best-effort — spawn failures are logged but not fatal.
    if (hasLogger()) {
      getLogger().warn({ err }, 'Failed to spawn background update check');
    }
  }
}
