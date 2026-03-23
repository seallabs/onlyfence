import { Box, Text } from 'ink';
import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import { isDaemonRunning } from '../../daemon/pid-manager.js';
import { theme } from '../theme.js';

/**
 * Persistent amber security banner shown on all TUI screens in Tier 0 (standalone mode).
 *
 * Only renders when the daemon is NOT running. When the daemon is active,
 * the banner disappears — the user has already upgraded to Tier 1.
 *
 * This banner is NOT dismissable — it provides ambient awareness of the
 * security posture without blocking the user.
 */
export function SecurityBanner(): ReactElement | null {
  const [daemonActive, setDaemonActive] = useState<boolean | null>(null);

  useEffect(() => {
    setDaemonActive(isDaemonRunning());
  }, []);

  // Don't render while checking, or if daemon is running
  if (daemonActive !== false) return null;

  return (
    <Box paddingX={1} marginBottom={1}>
      <Text color={theme.warning}>
        {
          '⚠ Standalone mode — Config and keystore accessible to local processes. For better security: fence start'
        }
      </Text>
    </Box>
  );
}
