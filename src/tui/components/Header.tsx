import { Box, Text } from 'ink';
import type { ReactElement } from 'react';
import { theme } from '../theme.js';
import { LogoSmall } from './Logo.js';
import { CURRENT_VERSION } from '../../update/index.js';

const CHANGELOG = [
  {
    version: 'v0.1.0',
    date: '2026-03-16',
    changes: 'Initial release — swap guardrails, policy engine',
  },
] as const;

const TAB_NAMES = ['Dashboard', 'Trades', 'Policy', 'Wallet'] as const;

interface HeaderProps {
  readonly activeTab: number;
}

export function Header({ activeTab }: HeaderProps): ReactElement {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.shadow} paddingX={1}>
      {/* Shortcuts bar — k9s style */}
      <Box flexWrap="wrap">
        {TAB_NAMES.map((tab, i) => (
          <Box key={tab} marginRight={1}>
            <Text color={theme.highlight} bold>{`<${i + 1}>`}</Text>
            <Text color={activeTab === i ? theme.eyes : theme.muted} bold={activeTab === i}>
              {` ${tab}`}
            </Text>
          </Box>
        ))}
        <Box marginRight={1}>
          <Text color={theme.highlight} bold>
            {'<q>'}
          </Text>
          <Text color={theme.muted}>{' Quit'}</Text>
        </Box>
        <Box>
          <Text color={theme.highlight} bold>
            {'<r>'}
          </Text>
          <Text color={theme.muted}>{' Refresh'}</Text>
        </Box>
      </Box>

      {/* Logo (left) + Changelog table (right) */}
      <Box marginTop={1}>
        <Box flexDirection="column" width="50%">
          <Box alignItems="center" gap={1}>
            <LogoSmall />
            <Box flexDirection="column">
              <Text bold color={theme.highlight}>
                OnlyFence
              </Text>
              <Text dimColor>AI Trading Guardrails</Text>
              <Text dimColor>{`v${CURRENT_VERSION}`}</Text>
            </Box>
          </Box>
        </Box>

        <Box flexDirection="column" width="50%">
          <Text color={theme.highlight} bold>
            {'Release Notes'}
          </Text>
          <Text color={theme.muted}>{'─'.repeat(50)}</Text>
          <Box>
            <Box width={10}>
              <Text color={theme.muted} bold>
                {'Version'}
              </Text>
            </Box>
            <Box width={14}>
              <Text color={theme.muted} bold>
                {'Date'}
              </Text>
            </Box>
            <Box>
              <Text color={theme.muted} bold>
                {'Changes'}
              </Text>
            </Box>
          </Box>
          {CHANGELOG.map((entry) => (
            <Box key={entry.version}>
              <Box width={10}>
                <Text color={theme.eyes}>{entry.version}</Text>
              </Box>
              <Box width={14}>
                <Text color={theme.eyes}>{entry.date}</Text>
              </Box>
              <Box>
                <Text color={theme.eyes}>{entry.changes}</Text>
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}
