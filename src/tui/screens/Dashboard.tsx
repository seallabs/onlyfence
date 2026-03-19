import { Box, Text } from 'ink';
import type { ReactElement } from 'react';
import { policyDecisionColor, theme } from '../theme.js';
import { useTui } from '../context.js';
import { useAutoRefresh } from '../hooks/useAutoRefresh.js';
import { useAsyncAutoRefresh } from '../hooks/useAsyncAutoRefresh.js';
import { Table } from '../components/Table.js';
import type { Column } from '../components/Table.js';
import { Panel } from '../components/Panel.js';
import { getPrimaryWallet } from '../../wallet/manager.js';
import {
  formatAmountWithDecimals,
  formatSmallestUnit,
  resolveSymbol,
} from '../../chain/sui/tokens.js';
import type { TradeRow } from '../../db/trade-log.js';

interface DashboardData {
  readonly walletAddress: string | null;
  readonly volume24h: number;
  readonly trades: readonly TradeRow[];
}

interface BalanceDisplayRow {
  readonly symbol: string;
  readonly balance: string;
}

/** Format an ISO timestamp to a compact "MM-DD HH:MM:SS" string. */
function shortTime(iso: string): string {
  // created_at is "YYYY-MM-DD HH:MM:SS"
  return iso.slice(5, 19);
}

const VOLUME_WARNING_THRESHOLD = 80;
const VOLUME_CRITICAL_THRESHOLD = 95;

const TRADE_COLUMNS: readonly Column<TradeRow>[] = [
  { header: 'Time', width: 16, accessor: (r) => shortTime(r.created_at) },
  { header: 'Chain', width: 6, accessor: (r) => r.chain_id },
  { header: 'From', width: 8, accessor: (r) => resolveSymbol(r.from_token) },
  { header: 'To', width: 8, accessor: (r) => resolveSymbol(r.to_token) },
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
    color: (r) => policyDecisionColor(r.policy_decision),
  },
];

const BALANCE_COLUMNS: readonly Column<BalanceDisplayRow>[] = [
  { header: 'Token', width: 10, accessor: (r) => r.symbol },
  { header: 'Balance', width: 24, accessor: (r) => r.balance, align: 'right' as const },
];

const BAR_WIDTH = 40;

export function Dashboard(): ReactElement {
  const { db, config, activeChain, activeChainId, policyRegistry, tradeLog, chainAdapterFactory } =
    useTui();

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

  const {
    data: balances,
    loading: balanceLoading,
    error: balanceError,
  } = useAsyncAutoRefresh<readonly BalanceDisplayRow[]>(
    async () => {
      if (data.walletAddress === null) return [];
      const adapter = chainAdapterFactory.get(activeChain);
      const result = await adapter.getBalance(data.walletAddress);
      return result.balances
        .filter((b) => b.amount > 0n)
        .map((b) => ({
          symbol: resolveSymbol(b.token),
          balance: formatAmountWithDecimals(b.amount.toString(), b.decimals, 4),
        }));
    },
    [],
    30000,
  );

  const maxVolume = chainConfig.limits?.max_24h_volume ?? 0;
  const volumePercent = maxVolume > 0 ? Math.min((data.volume24h / maxVolume) * 100, 100) : 0;
  const filledWidth = Math.round((volumePercent / 100) * BAR_WIDTH);
  const barColor =
    volumePercent > VOLUME_CRITICAL_THRESHOLD
      ? theme.error
      : volumePercent > VOLUME_WARNING_THRESHOLD
        ? theme.warning
        : theme.highlight;
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
        <Panel title="Wallet" width="50%">
          <Text color={theme.eyes}>{`Chain:   ${activeChain}`}</Text>
          <Text color={theme.eyes}>
            {`Address: ${data.walletAddress ?? 'No wallet configured'}`}
          </Text>
          <Text
            color={theme.eyes}
          >{`Status:  ${data.walletAddress !== null ? 'Primary' : '-'}`}</Text>
        </Panel>

        <Panel title="Policy Status" width="50%">
          <Text color={theme.eyes}>{`Active Checks: ${checks.length}`}</Text>
          {checks.map((name) => (
            <Text key={name} color={theme.success}>{`  + ${name}`}</Text>
          ))}
        </Panel>
      </Box>

      {/* Row 2: Account Balance */}
      <Panel title="Account Balance" marginTop={1}>
        {data.walletAddress === null ? (
          <Text color={theme.muted} italic>
            {'No wallet configured'}
          </Text>
        ) : balanceLoading ? (
          <Text color={theme.muted} italic>
            {'Loading balances...'}
          </Text>
        ) : balanceError !== null ? (
          <Text color={theme.error}>{`Error: ${balanceError}`}</Text>
        ) : balances.length === 0 ? (
          <Text color={theme.muted} italic>
            {'No token balances'}
          </Text>
        ) : (
          <Table columns={BALANCE_COLUMNS} data={balances} />
        )}
      </Panel>

      {/* Row 3: 24h Volume */}
      <Panel title="24h Rolling Volume" marginTop={1}>
        <Text color={theme.eyes}>
          {`$${data.volume24h.toFixed(2)} / ${maxVolume > 0 ? `$${maxVolume.toFixed(2)}` : 'No limit'}`}
        </Text>
        <Box>
          <Text color={theme.muted}>{'['}</Text>
          <Text color={barColor}>{'█'.repeat(filledWidth)}</Text>
          <Text color={theme.muted}>{'░'.repeat(BAR_WIDTH - filledWidth)}</Text>
          <Text color={theme.muted}>{']'}</Text>
          <Text color={theme.eyes}>{` ${volumePercent.toFixed(1)}%`}</Text>
        </Box>
      </Panel>

      {/* Row 4: Allowed Tokens + Spending Limits */}
      <Box marginTop={1}>
        <Panel title="Allowed Tokens" width="50%">
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
        </Panel>

        <Panel title="Spending Limits" width="50%">
          <Text color={theme.eyes}>
            {`Max Single Trade: ${chainConfig.limits !== undefined ? `$${chainConfig.limits.max_single_trade}` : 'None'}`}
          </Text>
          <Text color={theme.eyes}>
            {`Max 24h Volume:   ${chainConfig.limits !== undefined ? `$${chainConfig.limits.max_24h_volume}` : 'None'}`}
          </Text>
        </Panel>
      </Box>

      {/* Row 5: Recent Trades */}
      <Panel title="Recent Trades" marginTop={1}>
        <Table columns={TRADE_COLUMNS} data={data.trades} />
      </Panel>
    </Box>
  );
}
