import { Box, Text } from 'ink';
import type { ReactElement } from 'react';
import { theme } from '../theme.js';
import { useTui } from '../context.js';
import { useAutoRefresh } from '../hooks/useAutoRefresh.js';
import { Table } from '../components/Table.js';
import type { Column } from '../components/Table.js';
import { listWallets } from '../../wallet/manager.js';
import type { WalletInfo as WalletInfoType } from '../../wallet/types.js';

const WALLET_COLUMNS: readonly Column<WalletInfoType>[] = [
  { header: 'Chain', width: 10, accessor: (r) => r.chain },
  { header: 'Address', width: 50, accessor: (r) => r.address },
  { header: 'Derivation Path', width: 25, accessor: (r) => r.derivationPath ?? '-' },
  { header: 'Primary', width: 10, accessor: (r) => (r.isPrimary ? 'Yes' : 'No') },
];

export function WalletInfo(): ReactElement {
  const { db } = useTui();

  const { data: wallets } = useAutoRefresh(() => {
    return listWallets(db);
  }, 10000);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text color={theme.highlight} bold>
          {'Wallet Information'}
        </Text>
        <Text color={theme.muted}>{`  ─  ${wallets.length} wallet(s)`}</Text>
      </Box>

      <Box flexDirection="column" borderStyle="single" borderColor={theme.shadow} paddingX={1}>
        <Table columns={WALLET_COLUMNS} data={wallets} />
      </Box>

      {/* Wallet details summary */}
      {wallets.length > 0 && (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor={theme.shadow}
          paddingX={1}
          marginTop={1}
        >
          <Text color={theme.body} bold>
            {'Details'}
          </Text>
          {wallets.map((w) => (
            <Box key={w.address} flexDirection="column" marginBottom={1}>
              <Text color={theme.eyes}>
                {`${w.chain.toUpperCase()} ${w.isPrimary ? '(Primary)' : ''}`}
              </Text>
              <Text color={theme.muted}>{`  Address: ${w.address}`}</Text>
              <Text color={theme.muted}>{`  Path:    ${w.derivationPath ?? 'Imported'}`}</Text>
            </Box>
          ))}
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={theme.muted}>{'  Run "fence setup" to generate or import wallets'}</Text>
      </Box>
    </Box>
  );
}
