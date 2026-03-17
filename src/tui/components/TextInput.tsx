import { Box, Text, useInput } from 'ink';
import type { ReactElement } from 'react';
import { theme } from '../theme.js';

interface TextInputProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
}

/**
 * Inline text input for TUI field editing.
 *
 * Captures all keyboard input while mounted:
 * - Printable characters append to the value
 * - Backspace removes the last character
 * - Enter confirms the edit
 * - Escape cancels the edit
 */
export function TextInput({ value, onChange, onSubmit, onCancel }: TextInputProps): ReactElement {
  useInput((input, key) => {
    if (key.return) {
      onSubmit();
    } else if (key.escape) {
      onCancel();
    } else if (key.backspace || key.delete) {
      onChange(value.slice(0, -1));
    } else if (input !== '' && !key.ctrl && !key.meta) {
      onChange(value + input);
    }
  });

  return (
    <Box>
      <Text color={theme.eyes}>{value}</Text>
      <Text color={theme.highlight} bold>
        {'▎'}
      </Text>
    </Box>
  );
}
