import { createUpdateChecker, CURRENT_VERSION } from './index.js';
import { hasLogger, getLogger } from '../logger/index.js';

/**
 * Run the background update check.
 *
 * This function is called when the CLI is invoked with the hidden
 * --_update-check-bg flag. It fetches the latest version from GitHub,
 * writes the result to the local cache, and exits.
 *
 * Errors are logged to the file logger (if available) — never to
 * stdout/stderr since the process has no controlling terminal.
 */
export async function runBackgroundCheck(): Promise<void> {
  try {
    const checker = createUpdateChecker();
    await checker.checkFromSource(CURRENT_VERSION);
  } catch (err: unknown) {
    if (hasLogger()) {
      getLogger().warn({ err }, 'Background update check failed');
    }
  }
}
