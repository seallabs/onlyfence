import { Box } from 'ink';
import type { ReactElement } from 'react';
import { LogoHeader } from './components/Logo.js';
import { SetupWizard } from './screens/SetupWizard.js';

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
        <LogoHeader version="0.1.0" />
      </Box>
      <SetupWizard onComplete={onComplete} />
    </Box>
  );
}
