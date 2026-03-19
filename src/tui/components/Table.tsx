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
  /** Override color for this cell. Return undefined to use the default row color. */
  readonly color?: (row: T) => string | undefined;
}

interface TableProps<T> {
  readonly columns: readonly Column<T>[];
  readonly data: readonly T[];
  readonly highlightRow?: number;
}

/** Truncate a string to fit within maxLen, appending '..' if truncated. */
function truncate(value: string, maxLen: number): string {
  if (maxLen <= 0) return '';
  if (value.length <= maxLen) return value;
  if (maxLen <= 2) return value.slice(0, maxLen);
  return `${value.slice(0, maxLen - 2)}..`;
}

/**
 * Generic table component that renders a header, separator, and data rows.
 *
 * Supports column widths, left/right alignment, text truncation, per-cell
 * color overrides, and row highlighting.
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
      <Text color={theme.body}>{'─'.repeat(totalWidth)}</Text>

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
                const raw = col.accessor(row);
                const maxLen = col.width - 1;
                const value = truncate(raw, maxLen);
                const padded = col.align === 'right' ? value.padStart(maxLen) : value;
                const customColor = col.color?.(row);
                const cellColor = customColor ?? (isHighlighted ? theme.highlight : theme.eyes);
                const shouldDim = !isHighlighted && customColor === undefined && i % 2 === 1;
                return (
                  <Box key={col.header} width={col.width}>
                    <Text color={cellColor} dimColor={shouldDim}>
                      {padded}
                    </Text>
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
