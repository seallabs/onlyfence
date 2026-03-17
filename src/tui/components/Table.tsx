import { Box, Text } from 'ink';
import { useMemo } from 'react';
import type { ReactElement } from 'react';
import { theme } from '../theme.js';

/**
 * Column definition for the generic Table component.
 */
export interface Column<T> {
  readonly header: string;
  readonly accessor: (row: T) => string;
  readonly width: number;
  readonly align?: 'left' | 'right';
}

interface TableProps<T> {
  readonly columns: readonly Column<T>[];
  readonly data: readonly T[];
  readonly highlightRow?: number;
}

/**
 * Generic table component that renders a header, separator, and data rows.
 *
 * Supports column widths, left/right alignment, and row highlighting.
 */
export function Table<T>({ columns, data, highlightRow }: TableProps<T>): ReactElement {
  const totalWidth = useMemo(() => columns.reduce((sum, c) => sum + c.width, 0), [columns]);

  return (
    <Box flexDirection="column">
      {/* Header row */}
      <Box>
        {columns.map((col) => (
          <Box key={col.header} width={col.width}>
            <Text color={theme.highlight} bold>
              {col.align === 'right' ? col.header.padStart(col.width - 1) : col.header}
            </Text>
          </Box>
        ))}
      </Box>

      {/* Separator */}
      <Text color={theme.muted}>{'─'.repeat(totalWidth)}</Text>

      {/* Data rows */}
      {data.length === 0 ? (
        <Text color={theme.muted} italic>
          {'  No data'}
        </Text>
      ) : (
        data.map((row, i) => {
          const isHighlighted = i === highlightRow;
          return (
            <Box key={String(i)}>
              {columns.map((col) => {
                const value = col.accessor(row);
                const padded = col.align === 'right' ? value.padStart(col.width - 1) : value;
                return (
                  <Box key={col.header} width={col.width}>
                    <Text color={isHighlighted ? theme.highlight : theme.eyes}>{padded}</Text>
                  </Box>
                );
              })}
            </Box>
          );
        })
      )}
    </Box>
  );
}
