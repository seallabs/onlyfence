import type { AppComponents } from './bootstrap.js';
import { toErrorMessage } from '../utils/index.js';

/**
 * Attempt to resolve AppComponents from a lazy getter.
 *
 * On success, returns components. On failure, prints a structured error
 * response, sets process.exitCode to 1, and returns undefined.
 *
 * Commands should guard with:
 * ```
 * const components = withComponents(getComponents);
 * if (components === undefined) return;
 * ```
 */
export function withComponents(getComponents: () => AppComponents): AppComponents | undefined {
  try {
    return getComponents();
  } catch (err: unknown) {
    console.log(JSON.stringify({ status: 'error', error: toErrorMessage(err) }, null, 2));
    process.exitCode = 1;
    return undefined;
  }
}
