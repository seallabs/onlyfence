/**
 * Persisted cache file schema: ~/.onlyfence/update-check.json
 */
export interface UpdateCache {
  /** ISO-8601 timestamp of when the check was performed */
  readonly checkedAt: string;
  /** Latest available version (e.g. "0.2.0") */
  readonly latestVersion: string;
  /** Version that was current at time of check */
  readonly currentVersion: string;
}

/**
 * Resolved update status after comparing versions.
 */
export type UpdateStatus =
  | { readonly kind: 'up-to-date' }
  | {
      readonly kind: 'update-available';
      readonly latestVersion: string;
      readonly currentVersion: string;
    }
  | { readonly kind: 'unknown' };
