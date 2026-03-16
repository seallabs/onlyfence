/**
 * Convert an unknown caught error to a human-readable message string.
 *
 * @param err - The caught error value (may be Error, string, or anything)
 * @returns A string error message
 */
export function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
