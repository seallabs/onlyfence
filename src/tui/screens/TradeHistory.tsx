import { Box, Text, useInput } from 'ink';
import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  formatAmountWithDecimals,
  formatSmallestUnit,
  resolveSymbol,
} from '../../chain/sui/tokens.js';
import type { ActivityRow } from '../../db/activity-log.js';
import { Panel } from '../components/Panel.js';
import type { Column } from '../components/Table.js';
import { Table } from '../components/Table.js';
import { useTui } from '../context.js';
import { useAutoRefresh } from '../hooks/useAutoRefresh.js';
import { policyDecisionColor, theme } from '../theme.js';

const PAGE_SIZE = 15;

/** Format raw amount using joined decimals, falling back to coinType-based lookup */
function formatAmount(raw: string, coinType: string, decimals: number | null): string {
  if (decimals !== null) return formatAmountWithDecimals(raw, decimals);
  return formatSmallestUnit(raw, coinType);
}

const COLUMNS: readonly Column<ActivityRow>[] = [
  { header: 'ID', width: 6, accessor: (r) => String(r.id) },
  { header: 'Time', width: 20, accessor: (r) => r.created_at },
  { header: 'Chain', width: 6, accessor: (r) => r.chain_id },
  { header: 'Action', width: 8, accessor: (r) => r.action },
  {
    header: 'From',
    width: 8,
    accessor: (r) => r.token_a_symbol ?? r.token_a_type ?? '-',
  },
  {
    header: 'To',
    width: 8,
    accessor: (r) => r.token_b_symbol ?? r.token_b_type ?? '-',
  },
  {
    header: 'Amount In',
    width: 16,
    accessor: (r) =>
      r.token_a_amount !== null && r.token_a_type !== null
        ? formatAmount(r.token_a_amount, r.token_a_type, r.token_a_decimals)
        : '-',
    align: 'right' as const,
  },
  {
    header: 'Amount Out',
    width: 16,
    accessor: (r) =>
      r.token_b_amount !== null && r.token_b_type !== null
        ? formatAmount(r.token_b_amount, r.token_b_type, r.token_b_decimals)
        : '-',
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
  {
    header: 'Tx Digest',
    width: 16,
    accessor: (r) => (r.tx_digest !== null ? `${r.tx_digest.slice(0, 12)}..` : '-'),
  },
];

export function TradeHistory(): ReactElement {
  const { activeChain, activeChainId, mode, activityLog } = useTui();

  const [page, setPage] = useState(0);
  const [selectedRow, setSelectedRow] = useState(0);
  const pageRef = useRef(0);

  const { data, refresh } = useAutoRefresh(() => {
    const trades = activityLog.getRecentActivities(
      activeChainId,
      PAGE_SIZE,
      pageRef.current * PAGE_SIZE,
    );
    const totalCount = activityLog.getActivityCount(activeChainId);
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

      <Panel>
        <Table columns={COLUMNS} data={data.trades} highlightRow={selectedRow} />
      </Panel>

      {/* Detail panel for selected trade */}
      {selected !== undefined && (
        <Panel title="Trade Detail" marginTop={1} borderColor={theme.body}>
          <Box>
            <Box flexDirection="column" width="50%">
              <Text color={theme.eyes}>{`ID:        ${selected.id}`}</Text>
              <Text color={theme.eyes}>{`Time:      ${selected.created_at}`}</Text>
              <Text color={theme.eyes}>{`Action:    ${selected.action}`}</Text>
              <Text
                color={theme.eyes}
              >{`Pair:      ${selected.token_a_symbol ?? selected.token_a_type ?? '-'} -> ${selected.token_b_symbol ?? selected.token_b_type ?? '-'}`}</Text>
              <Text color={theme.eyes}>{`Protocol:  ${selected.protocol ?? '-'}`}</Text>
            </Box>
            <Box flexDirection="column" width="50%">
              <Text
                color={theme.eyes}
              >{`Amount In:  ${selected.token_a_amount !== null && selected.token_a_type !== null ? `${formatAmount(selected.token_a_amount, selected.token_a_type, selected.token_a_decimals)} ${selected.token_a_symbol ?? resolveSymbol(selected.token_a_type)}` : '-'}`}</Text>
              <Text
                color={theme.eyes}
              >{`Amount Out: ${selected.token_b_amount !== null && selected.token_b_type !== null ? `${formatAmount(selected.token_b_amount, selected.token_b_type, selected.token_b_decimals)} ${selected.token_b_symbol ?? resolveSymbol(selected.token_b_type)}` : '-'}`}</Text>
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
        </Panel>
      )}

      <Box marginTop={1}>
        <Text color={theme.muted}>{'  ↑↓ Navigate    j/k Page down/up'}</Text>
      </Box>
    </Box>
  );
}
