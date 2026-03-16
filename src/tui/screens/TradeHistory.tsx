import { Box, Text, useInput } from 'ink';
import { useState, useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import { theme } from '../theme.js';
import { useTui } from '../context.js';
import { useAutoRefresh } from '../hooks/useAutoRefresh.js';
import { Table } from '../components/Table.js';
import type { Column } from '../components/Table.js';
import type { TradeRow } from '../../db/trade-log.js';

const PAGE_SIZE = 15;

const COLUMNS: readonly Column<TradeRow>[] = [
  { header: 'ID', width: 6, accessor: (r) => String(r.id) },
  { header: 'Time', width: 20, accessor: (r) => r.created_at },
  { header: 'Action', width: 8, accessor: (r) => r.action },
  { header: 'From', width: 8, accessor: (r) => r.from_token },
  { header: 'To', width: 8, accessor: (r) => r.to_token },
  { header: 'Amount In', width: 14, accessor: (r) => r.amount_in },
  {
    header: 'Amount Out',
    width: 14,
    accessor: (r) => r.amount_out ?? '-',
  },
  {
    header: 'USD',
    width: 12,
    accessor: (r) => (r.value_usd !== null ? `$${r.value_usd.toFixed(2)}` : '-'),
  },
  { header: 'Status', width: 10, accessor: (r) => r.policy_decision },
  {
    header: 'Tx Digest',
    width: 16,
    accessor: (r) => (r.tx_digest !== null ? `${r.tx_digest.slice(0, 12)}..` : '-'),
  },
];

export function TradeHistory(): ReactElement {
  const { activeChain, mode, tradeLog } = useTui();

  const [page, setPage] = useState(0);
  const [selectedRow, setSelectedRow] = useState(0);
  const pageRef = useRef(0);

  const { data, refresh } = useAutoRefresh(() => {
    const trades = tradeLog.getRecentTrades(activeChain, PAGE_SIZE, pageRef.current * PAGE_SIZE);
    const totalCount = tradeLog.getTradeCount(activeChain);
    return { trades, totalCount };
  }, 5000);

  const totalPages = Math.max(1, Math.ceil(data.totalCount / PAGE_SIZE));

  // Clamp selectedRow when trades list changes size
  useEffect(() => {
    setSelectedRow((r) => Math.min(r, Math.max(0, data.trades.length - 1)));
  }, [data.trades.length]);

  useInput(
    (input, key) => {
      if (key.upArrow) {
        setSelectedRow((r) => Math.max(0, r - 1));
      } else if (key.downArrow) {
        setSelectedRow((r) => Math.min(Math.max(0, data.trades.length - 1), r + 1));
      } else if (input === 'k') {
        const next = Math.max(0, page - 1);
        pageRef.current = next;
        setPage(next);
        setSelectedRow(0);
        refresh();
      } else if (input === 'j') {
        const next = Math.min(totalPages - 1, page + 1);
        pageRef.current = next;
        setPage(next);
        setSelectedRow(0);
        refresh();
      }
    },
    { isActive: mode === 'navigate' },
  );

  // Detail view for selected trade
  const selected = data.trades[selectedRow];

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text color={theme.highlight} bold>
          {'Trade History'}
        </Text>
        <Text color={theme.muted}>
          {`  ─  ${data.totalCount} trades  ─  Chain: ${activeChain}  ─  Page ${page + 1}/${totalPages}`}
        </Text>
      </Box>

      <Box flexDirection="column" borderStyle="single" borderColor={theme.shadow} paddingX={1}>
        <Table columns={COLUMNS} data={data.trades} highlightRow={selectedRow} />
      </Box>

      {/* Detail panel for selected trade */}
      {selected !== undefined && (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor={theme.body}
          paddingX={1}
          marginTop={1}
        >
          <Text color={theme.body} bold>
            {'Trade Detail'}
          </Text>
          <Box>
            <Box flexDirection="column" width="50%">
              <Text color={theme.eyes}>{`ID:        ${selected.id}`}</Text>
              <Text color={theme.eyes}>{`Time:      ${selected.created_at}`}</Text>
              <Text color={theme.eyes}>{`Action:    ${selected.action}`}</Text>
              <Text
                color={theme.eyes}
              >{`Pair:      ${selected.from_token} -> ${selected.to_token}`}</Text>
              <Text color={theme.eyes}>{`Protocol:  ${selected.protocol ?? '-'}`}</Text>
            </Box>
            <Box flexDirection="column" width="50%">
              <Text color={theme.eyes}>{`Amount In:  ${selected.amount_in}`}</Text>
              <Text color={theme.eyes}>{`Amount Out: ${selected.amount_out ?? '-'}`}</Text>
              <Text
                color={theme.eyes}
              >{`USD Value:  ${selected.value_usd !== null ? `$${selected.value_usd.toFixed(2)}` : '-'}`}</Text>
              <Text
                color={theme.eyes}
              >{`Gas Cost:   ${selected.gas_cost !== null ? selected.gas_cost.toFixed(4) : '-'}`}</Text>
              <Text color={selected.policy_decision === 'approved' ? theme.success : theme.error}>
                {`Decision:   ${selected.policy_decision}${selected.rejection_reason !== null ? ` (${selected.rejection_reason})` : ''}`}
              </Text>
            </Box>
          </Box>
          {selected.tx_digest !== null && (
            <Text color={theme.muted}>{`Tx: ${selected.tx_digest}`}</Text>
          )}
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={theme.muted}>{'  ↑↓ Navigate    j/k Page down/up'}</Text>
      </Box>
    </Box>
  );
}
