import { Box, Text } from 'ink';
import type { ReactElement } from 'react';
import { theme } from '../theme.js';
import { useTui } from '../context.js';
import { LogoSmall } from './Logo.js';
import { CURRENT_VERSION } from '../../update/index.js';
import { CHANGELOG } from '../../changelog.js';

const TAB_NAMES = ['Dashboard', 'Trades', 'Policy', 'Wallet', 'Security'] as const;

interface HeaderProps {
  readonly activeTab: number;
}

export function Header({ activeTab }: HeaderProps): ReactElement {
  const { activeChain, availableChains } = useTui();
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.panelBorder} paddingX={1}>
      {/* Shortcuts bar */}
      <Box flexWrap="wrap">
        {TAB_NAMES.map((tab, i) => (
          <Box key={tab} marginRight={1}>
            <Text color={theme.highlight} bold>{`<${i + 1}>`}</Text>
            <Text
              color={activeTab === i ? theme.eyes : theme.muted}
              bold={activeTab === i}
              underline={activeTab === i}
            >
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
        <Box marginRight={1}>
          <Text color={theme.highlight} bold>
            {'<r>'}
          </Text>
          <Text color={theme.muted}>{' Refresh'}</Text>
        </Box>
        {availableChains.length > 1 && (
          <Box marginRight={1}>
            <Text color={theme.highlight} bold>
              {'<c>'}
            </Text>
            <Text color={theme.muted}>{' Chain'}</Text>
          </Box>
        )}
        <Box>
          <Text color={theme.eyes} bold>{`[${activeChain}]`}</Text>
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
          <Text color={theme.body}>{'─'.repeat(50)}</Text>
          <Box>
            <Box width={10}>
              <Text color={theme.body} bold>
                {'Version'}
              </Text>
            </Box>
            <Box width={14}>
              <Text color={theme.body} bold>
                {'Date'}
              </Text>
            </Box>
            <Box>
              <Text color={theme.body} bold>
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
