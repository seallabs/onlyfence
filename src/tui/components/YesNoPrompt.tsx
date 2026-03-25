import { Box, Text } from 'ink';
import type { ReactElement } from 'react';
import { theme } from '../theme.js';

interface YesNoPromptProps {
  readonly title: string;
  readonly descriptions: readonly string[];
  readonly yesLabel: string;
  readonly noLabel: string;
  readonly hint: string;
  readonly errorMessage?: string | undefined;
}

/**
 * Presentational component for a yes/no preference prompt.
 *
 * Used by SetupWizard steps and standalone TelemetryPrompt.
 * Does not handle input — the caller wires useInput or equivalent.
 */
export function YesNoPrompt({
  title,
  descriptions,
  yesLabel,
  noLabel,
  hint,
  errorMessage,
}: YesNoPromptProps): ReactElement {
  return (
    <Box flexDirection="column">
      <Text color={theme.eyes}>{title}</Text>
      {descriptions.map((desc, i) => (
        <Box key={desc} marginTop={i === 0 ? 1 : 0}>
          <Text color={theme.eyes}>{desc}</Text>
        </Box>
      ))}

      <Box marginTop={1}>
        <Text color={theme.body}>{'  Press '}</Text>
        <Text color={theme.success} bold>
          {'y'}
        </Text>
        <Text color={theme.body}>{` ${yesLabel}`}</Text>
      </Box>
      <Box>
        <Text color={theme.body}>{'  Press '}</Text>
        <Text color={theme.highlight} bold>
          {'n'}
        </Text>
        <Text color={theme.body}>{` ${noLabel}`}</Text>
      </Box>
      {errorMessage !== undefined && errorMessage.length > 0 && (
        <Box marginTop={1}>
          <Text color={theme.error}>{errorMessage}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color={theme.muted}>{hint}</Text>
      </Box>
    </Box>
  );
}
