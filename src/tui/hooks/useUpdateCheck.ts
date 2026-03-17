import { useState, useEffect } from 'react';
import type { UpdateStatus } from '../../types/update.js';
import type { UpdateChecker } from '../../update/checker.js';
import { hasLogger, getLogger } from '../../logger/index.js';

/**
 * Hook that checks for updates on mount.
 *
 * 1. Reads the local cache synchronously for an instant result (~1ms).
 * 2. Only fires an async network fetch if the cache is stale/absent.
 * 3. Updates state when the fetch resolves.
 *
 * Network errors are non-fatal — they leave status unchanged but are logged.
 */
export function useUpdateCheck(checker: UpdateChecker, currentVersion: string): UpdateStatus {
  const [status, setStatus] = useState<UpdateStatus>(() => checker.checkFromCache(currentVersion));

  useEffect(() => {
    // Only fetch from network if the cache is stale or absent.
    // When cache is fresh, checkFromCache already returned the correct status.
    if (status.kind !== 'unknown') {
      return;
    }

    let cancelled = false;

    checker
      .checkFromSource(currentVersion)
      .then((result) => {
        if (!cancelled) {
          setStatus(result);
        }
      })
      .catch((err: unknown) => {
        // Network failure in the TUI is non-fatal — leave status as 'unknown'.
        if (hasLogger()) {
          getLogger().debug({ err }, 'TUI update check failed (non-fatal)');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [checker, currentVersion, status.kind]);

  return status;
}
