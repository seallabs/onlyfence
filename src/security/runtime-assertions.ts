/**
 * Runtime security assertions that fail fast on invariant violations.
 *
 * These run at process entry and daemon startup to catch misconfigurations
 * before they can be exploited. Each assertion throws with an actionable
 * error message.
 */

/**
 * Assert that no password appears in the current process argv.
 *
 * Should be called at process entry. Prevents accidental leaks where
 * a password is passed as a CLI argument (visible in `ps aux`).
 */
export function assertNoPasswordInArgv(): void {
  for (const arg of process.argv) {
    if (arg === '--password') {
      throw new Error(
        'SECURITY: Password detected in process arguments.\n' +
          '  Passwords in argv are visible to all local users via `ps aux`.\n' +
          '  Use interactive prompt, FENCE_PASSWORD_FILE, or stdin pipe instead.\n' +
          '  This is a bug — please report it.',
      );
    }
  }
}
