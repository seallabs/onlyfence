import { Box, Text } from 'ink';
import type { ReactElement, ReactNode } from 'react';
import { theme } from '../theme.js';

interface PanelProps {
  readonly title?: string;
  readonly children: ReactNode;
  readonly width?: string | number;
  readonly marginTop?: number;
  readonly borderColor?: string;
}

/**
 * Reusable panel with round borders and optional title.
 *
 * Provides consistent styling across all TUI screens.
 */
export function Panel({
  title,
  children,
  width,
  marginTop,
  borderColor,
}: PanelProps): ReactElement {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={borderColor ?? theme.panelBorder}
      paddingX={1}
      width={width}
      marginTop={marginTop}
    >
      {title !== undefined && (
        <Text color={theme.body} bold>
          {title}
        </Text>
      )}
      {children}
    </Box>
  );
}
