/**
 * Execute an async function with console.log suppressed.
 *
 * Some external SDKs (e.g. Bluefin Pro) use console.log for internal
 * messages ("Logging in...", "Scheduling token refresh...", etc.) which
 * pollute stdout and break JSON parsing for CLI consumers.
 *
 * This utility temporarily replaces console.log with a no-op during the
 * provided function's execution, then restores it in the finally block.
 *
 * @param fn - Async function to execute with suppressed console.log
 * @returns The result of the function
 */
export async function withSuppressedLogs<T>(fn: () => Promise<T>): Promise<T> {
  // eslint-disable-next-line no-console -- intentionally intercepting console.log
  const originalLog = console.log;
  // eslint-disable-next-line no-console, @typescript-eslint/no-empty-function -- suppressing SDK noise
  console.log = () => {};
  try {
    return await fn();
  } finally {
    // eslint-disable-next-line no-console -- restoring original console.log
    console.log = originalLog;
  }
}
