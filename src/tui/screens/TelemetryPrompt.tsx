import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { updateConfigFile } from '../../config/loader.js';
import { toErrorMessage } from '../../utils/index.js';
import { theme } from '../theme.js';

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
      <Box flexDirection="column" marginBottom={1}>
        <Text color={theme.highlight} bold>
          {'Anonymous Error Reporting'}
        </Text>
        <Text color={theme.muted}>{'─'.repeat(50)}</Text>
      </Box>

      <Box flexDirection="column">
        <Text color={theme.eyes}>
          {'OnlyFence can report anonymous crash data to help improve the tool.'}
        </Text>
        <Text color={theme.eyes}>
          {'No wallet addresses, keys, balances, or trade data will be sent.'}
        </Text>

        <Box marginTop={1}>
          <Text color={theme.body}>{'  Press '}</Text>
          <Text color={theme.success} bold>
            {'y'}
          </Text>
          <Text color={theme.body}>{' to enable anonymous error reporting'}</Text>
        </Box>
        <Box>
          <Text color={theme.body}>{'  Press '}</Text>
          <Text color={theme.highlight} bold>
            {'n'}
          </Text>
          <Text color={theme.body}>{' to keep it disabled (default)'}</Text>
        </Box>
      </Box>

      {error !== null && (
        <Box marginTop={1}>
          <Text color={theme.error}>{`Error: ${error}`}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={theme.muted}>{'You can change this later in config.toml [telemetry]'}</Text>
      </Box>
    </Box>
  );
}
