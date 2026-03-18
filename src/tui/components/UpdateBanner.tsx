import { Box, Text } from 'ink';
import type { ReactElement } from 'react';
import type { UpdateStatus } from '../../types/update.js';
import { theme } from '../theme.js';

interface UpdateBannerProps {
  readonly status: UpdateStatus;
}

/**
 * Renders a single-line update notification banner.
 *
 * Only visible when an update is available. Renders nothing for
 * 'up-to-date' or 'unknown' states — no layout shift.
 */
export function UpdateBanner({ status }: UpdateBannerProps): ReactElement | null {
  if (status.kind !== 'update-available') {
    return null;
  }

  return (
    <Box paddingX={1} marginBottom={1}>
      <Text color={theme.warning} bold>
        {`Update available: v${status.currentVersion} → v${status.latestVersion}  —  run "fence update" to install`}
      </Text>
    </Box>
  );
}
