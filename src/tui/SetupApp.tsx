import { Box } from 'ink';
import type { ReactElement } from 'react';
import { LogoHeader } from './components/Logo.js';
import { SetupWizard } from './screens/SetupWizard.js';
import { CURRENT_VERSION } from '../update/index.js';

interface SetupAppProps {
  readonly onComplete: () => void;
}

/**
 * Minimal shell for the first-run setup wizard.
 * Shows a compact logo header and delegates to SetupWizard.
 */
export function SetupApp({ onComplete }: SetupAppProps): ReactElement {
  return (
    <Box flexDirection="column">
      <Box paddingX={1} paddingY={1}>
        <LogoHeader version={CURRENT_VERSION} />
      </Box>
      <SetupWizard onComplete={onComplete} />
    </Box>
  );
}
