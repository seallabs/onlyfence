import { Box, useInput } from 'ink';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { updateConfigFile } from '../../config/loader.js';
import { toErrorMessage } from '../../utils/index.js';
import { YesNoPrompt } from '../components/YesNoPrompt.js';

interface TelemetryPromptProps {
  readonly onComplete: (enabled: boolean) => void;
}

/**
 * First-run telemetry consent screen.
 *
 * Shown only in TUI mode when `config.telemetry` is absent from config.toml.
 * Writes the user's choice to the config file so the prompt never appears again.
 */
export function TelemetryPrompt({ onComplete }: TelemetryPromptProps): ReactElement {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useInput(
    (input) => {
      if (input === 'y' || input === 'Y') {
        saveTelemetryChoice(true);
      } else if (input === 'n' || input === 'N') {
        saveTelemetryChoice(false);
      }
    },
    { isActive: !saving },
  );

  function saveTelemetryChoice(enabled: boolean): void {
    setSaving(true);
    try {
      updateConfigFile((raw) => {
        raw['telemetry'] = { enabled };
      });
      onComplete(enabled);
    } catch (err: unknown) {
      setError(toErrorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <YesNoPrompt
        title="Anonymous Error Reporting"
        descriptions={[
          'OnlyFence can report anonymous crash data to help improve the tool.',
          'No wallet addresses, keys, balances, or trade data will be sent.',
        ]}
        yesLabel="to enable anonymous error reporting"
        noLabel="to keep it disabled (default)"
        hint="You can change this later in config.toml [telemetry]"
        errorMessage={error ?? undefined}
      />
    </Box>
  );
}
