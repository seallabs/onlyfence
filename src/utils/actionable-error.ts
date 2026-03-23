/**
 * Error type that always answers: What happened? Why? How to fix?
 *
 * Used for user-facing errors across all CLI commands to ensure
 * every error message is actionable.
 */
export class ActionableError extends Error {
  constructor(
    readonly what: string,
    readonly why: string,
    readonly fix: string,
  ) {
    super(what);
    this.name = 'ActionableError';
  }
}

/**
 * Format an ActionableError for display on stderr.
 */
export function formatActionableError(err: ActionableError): string {
  return `Error: ${err.what}\n` + `  Reason:  ${err.why}\n` + `  To fix:  ${err.fix}`;
}
