/**
 * Convert an unknown caught error to a human-readable message string.
 *
 * @param err - The caught error value (may be Error, string, or anything)
 * @returns A string error message
 */
export function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Type guard for ENOENT filesystem errors.
 */
export function isEnoentError(err: unknown): boolean {
  return err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT';
}
