import { Box, Text } from 'ink';
import type { ReactElement } from 'react';
import { theme } from '../theme.js';
import { useTui } from '../context.js';
import { useAutoRefresh } from '../hooks/useAutoRefresh.js';
import { Table } from '../components/Table.js';
import type { Column } from '../components/Table.js';
import { getPrimaryWallet } from '../../wallet/manager.js';
import { formatSmallestUnit } from '../../chain/sui/tokens.js';
import type { TradeRow } from '../../db/trade-log.js';

interface DashboardData {
  readonly walletAddress: string | null;
  readonly volume24h: number;
  readonly trades: readonly TradeRow[];
}

/** Extract the coin symbol from a full type path (e.g. "0x2::sui::SUI" -> "SUI"). */
function coinSymbol(typeTag: string): string {
  const parts = typeTag.split('::');
  return parts[parts.length - 1] ?? typeTag;
}

/** Format an ISO timestamp to a compact "MM-DD HH:MM:SS" string. */
function shortTime(iso: string): string {
  // created_at is "YYYY-MM-DD HH:MM:SS"
  return iso.slice(5, 19);
}

function statusColor(row: TradeRow): string | undefined {
  switch (row.policy_decision) {
    case 'approved':
      return theme.success;
    case 'rejected':
      return theme.error;
    default:
      return theme.warning;
  }
}

const TRADE_COLUMNS: readonly Column<TradeRow>[] = [
  { header: 'Time', width: 16, accessor: (r) => shortTime(r.created_at) },
  { header: 'Chain', width: 6, accessor: (r) => r.chain_id },
  { header: 'From', width: 8, accessor: (r) => coinSymbol(r.from_token) },
  { header: 'To', width: 8, accessor: (r) => coinSymbol(r.to_token) },
  {
    header: 'Amount In',
    width: 16,
    accessor: (r) => formatSmallestUnit(r.amount_in, r.from_token),
    align: 'right' as const,
  },
  {
    header: 'Amount Out',
    width: 16,
    accessor: (r) => (r.amount_out !== null ? formatSmallestUnit(r.amount_out, r.to_token) : '-'),
    align: 'right' as const,
  },
  {
    header: 'USD',
    width: 12,
    accessor: (r) => (r.value_usd !== null ? `$${r.value_usd.toFixed(2)}` : '-'),
    align: 'right' as const,
  },
  {
    header: 'Status',
    width: 12,
    accessor: (r) => r.policy_decision,
    color: statusColor,
  },
];

const BAR_WIDTH = 40;

export function Dashboard(): ReactElement {
  const { db, config, activeChain, activeChainId, policyRegistry, tradeLog } = useTui();

  const chainConfig = config.chain[activeChain];

  const { data } = useAutoRefresh<DashboardData>(() => {
    const wallet = getPrimaryWallet(db, activeChainId);
    const volume = tradeLog.getRolling24hVolume(activeChainId);
    const trades = tradeLog.getRecentTrades(activeChainId, 5);
    return {
      walletAddress: wallet?.address ?? null,
      volume24h: volume,
      trades,
    };
  }, 5000);

  const maxVolume = chainConfig.limits?.max_24h_volume ?? 0;
  const volumePercent = maxVolume > 0 ? Math.min((data.volume24h / maxVolume) * 100, 100) : 0;
  const filledWidth = Math.round((volumePercent / 100) * BAR_WIDTH);
  const tokens = chainConfig.allowlist?.tokens ?? [];
  const checks = policyRegistry.registeredChecks;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text color={theme.highlight} bold>
          {'Dashboard'}
        </Text>
        <Text color={theme.muted}>{`  ─  Chain: ${activeChain}`}</Text>
      </Box>

      {/* Row 1: Wallet + Policy side by side */}
      <Box>
        <Box
          flexDirection="column"
          width="50%"
          borderStyle="single"
          borderColor={theme.shadow}
          paddingX={1}
        >
          <Text color={theme.body} bold>
            {'Wallet'}
          </Text>
          <Text color={theme.eyes}>{`Chain:   ${activeChain}`}</Text>
          <Text color={theme.eyes}>
            {`Address: ${data.walletAddress ?? 'No wallet configured'}`}
          </Text>
          <Text
            color={theme.eyes}
          >{`Status:  ${data.walletAddress !== null ? 'Primary' : '-'}`}</Text>
        </Box>

        <Box
          flexDirection="column"
          width="50%"
          borderStyle="single"
          borderColor={theme.shadow}
          paddingX={1}
        >
          <Text color={theme.body} bold>
            {'Policy Status'}
          </Text>
          <Text color={theme.eyes}>{`Active Checks: ${checks.length}`}</Text>
          {checks.map((name) => (
            <Text key={name} color={theme.success}>{`  + ${name}`}</Text>
          ))}
        </Box>
      </Box>

      {/* Row 2: 24h Volume */}
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor={theme.shadow}
        paddingX={1}
        marginTop={1}
      >
        <Text color={theme.body} bold>
          {'24h Rolling Volume'}
        </Text>
        <Text color={theme.eyes}>
          {`$${data.volume24h.toFixed(2)} / ${maxVolume > 0 ? `$${maxVolume.toFixed(2)}` : 'No limit'}  (${volumePercent.toFixed(1)}%)`}
        </Text>
        <Box>
          <Text color={volumePercent > 80 ? theme.warning : theme.highlight}>
            {'█'.repeat(filledWidth)}
          </Text>
          <Text color={theme.muted}>{'░'.repeat(BAR_WIDTH - filledWidth)}</Text>
        </Box>
      </Box>

      {/* Row 3: Allowed Tokens + Spending Limits */}
      <Box marginTop={1}>
        <Box
          flexDirection="column"
          width="50%"
          borderStyle="single"
          borderColor={theme.shadow}
          paddingX={1}
        >
          <Text color={theme.body} bold>
            {'Allowed Tokens'}
          </Text>
          {tokens.length > 0 ? (
            <Box flexWrap="wrap">
              {tokens.map((token) => (
                <Box key={token} marginRight={1}>
                  <Text color={theme.eyes}>{token}</Text>
                </Box>
              ))}
            </Box>
          ) : (
            <Text color={theme.muted} italic>
              {'No tokens configured'}
            </Text>
          )}
        </Box>

        <Box
          flexDirection="column"
          width="50%"
          borderStyle="single"
          borderColor={theme.shadow}
          paddingX={1}
        >
          <Text color={theme.body} bold>
            {'Spending Limits'}
          </Text>
          <Text color={theme.eyes}>
            {`Max Single Trade: ${chainConfig.limits !== undefined ? `$${chainConfig.limits.max_single_trade}` : 'None'}`}
          </Text>
          <Text color={theme.eyes}>
            {`Max 24h Volume:   ${chainConfig.limits !== undefined ? `$${chainConfig.limits.max_24h_volume}` : 'None'}`}
          </Text>
        </Box>
      </Box>

      {/* Row 4: Recent Trades */}
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor={theme.shadow}
        paddingX={1}
        marginTop={1}
      >
        <Text color={theme.body} bold>
          {'Recent Trades'}
        </Text>
        <Table columns={TRADE_COLUMNS} data={data.trades} />
      </Box>
    </Box>
  );
}
