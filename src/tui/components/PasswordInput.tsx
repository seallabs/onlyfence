import { Box, Text, useInput } from 'ink';
import type { ReactElement } from 'react';
import { theme } from '../theme.js';

interface PasswordInputProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
}

/**
 * Masked password input for TUI.
 *
 * Displays asterisks instead of the actual characters.
 * Enter submits, Backspace deletes.
 */
export function PasswordInput({ value, onChange, onSubmit }: PasswordInputProps): ReactElement {
  useInput((input, key) => {
    if (key.return) {
      onSubmit();
    } else if (key.backspace || key.delete) {
      onChange(value.slice(0, -1));
    } else if (input && !key.ctrl && !key.meta && !key.escape) {
      onChange(value + input);
    }
  });

  return (
    <Box>
      <Text color={theme.eyes}>{'*'.repeat(value.length)}</Text>
      <Text color={theme.highlight} bold>
        {'▎'}
      </Text>
    </Box>
  );
}
