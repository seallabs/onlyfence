import { Box, Text, useInput } from 'ink';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { getRegistryEntries, REGISTRY_ALIASES_UPPER } from '../../chain/sui/tokens.js';
import type { CoinMetadataService } from '../../data/coin-metadata.js';
import { extractTokenSymbol, toErrorMessage } from '../../utils/index.js';
import { theme } from '../theme.js';

/** Maximum number of rows visible in the scrollable token list. */
const VISIBLE_ROWS = 15;

/** Maximum display width for the package address portion. */
const PKG_DISPLAY_LEN = 8;

interface TokenSelectPopupProps {
  readonly initialTokens: readonly string[];
  readonly coinMetadataService: CoinMetadataService;
  readonly onConfirm: (tokens: readonly string[]) => void;
  readonly onCancel: () => void;
}

type Phase = 'list' | 'custom-input' | 'discovering' | 'custom-confirm';

interface DiscoveredToken {
  readonly symbol: string;
  readonly decimals: number;
  readonly coinType: string;
}

type ListItem =
  | {
      readonly kind: 'token';
      readonly alias: string;
      readonly coinType: string;
      readonly isCustom: boolean;
    }
  | { readonly kind: 'add-custom' };

/**
 * Shorten a fully-qualified coin type for display.
 * "0xabcdef1234...::module::TYPE" -> "0xabcdef12...::module::TYPE"
 */
function shortCoinType(coinType: string): string {
  const parts = coinType.split('::');
  if (parts.length < 3) return coinType;
  const pkg = parts[0] ?? '';
  const rest = parts.slice(1).join('::');
  if (pkg.length <= PKG_DISPLAY_LEN + 2) return coinType;
  return `${pkg.slice(0, PKG_DISPLAY_LEN)}…::${rest}`;
}

/**
 * Multiselect token popup for choosing allowed tokens.
 *
 * Displays registry tokens with search/filter and toggle selection.
 * Supports adding custom coin types with RPC-based metadata discovery.
 */
export function TokenSelectPopup({
  initialTokens,
  coinMetadataService,
  onConfirm,
  onCancel,
}: TokenSelectPopupProps): ReactElement {
  const registry = getRegistryEntries();
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  // Core state
  const [phase, setPhase] = useState<Phase>('list');
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialTokens.map((t) => t.toUpperCase())),
  );
  const [customTokens, setCustomTokens] = useState<readonly string[]>(() =>
    initialTokens.filter((t) => !REGISTRY_ALIASES_UPPER.has(t.toUpperCase())),
  );
  const [cursor, setCursor] = useState(0);
  const [filter, setFilter] = useState('');
  const [scrollOffset, setScrollOffset] = useState(0);

  // Custom coin type input state
  const [customInput, setCustomInput] = useState('');
  const [discovered, setDiscovered] = useState<DiscoveredToken | null>(null);
  const [discoverError, setDiscoverError] = useState<string | null>(null);

  // Build unified display list: custom tokens + filtered registry + "Add custom" option
  const items: readonly ListItem[] = useMemo(() => {
    const result: ListItem[] = [];

    for (const ct of customTokens) {
      result.push({ kind: 'token', alias: ct, coinType: '', isCustom: true });
    }

    const lcFilter = filter.toLowerCase();
    for (const entry of registry) {
      if (
        filter === '' ||
        entry.alias.toLowerCase().includes(lcFilter) ||
        entry.coinType.toLowerCase().includes(lcFilter)
      ) {
        result.push({
          kind: 'token',
          alias: entry.alias,
          coinType: entry.coinType,
          isCustom: false,
        });
      }
    }

    result.push({ kind: 'add-custom' });

    return result;
  }, [customTokens, registry, filter]);

  // Reset cursor/scroll when filter changes
  useEffect(() => {
    setCursor(0);
    setScrollOffset(0);
  }, [filter]);

  // Clamp cursor when item count shrinks
  useEffect(() => {
    setCursor((prev) => Math.min(prev, Math.max(0, items.length - 1)));
  }, [items.length]);

  const ensureVisible = useCallback((newCursor: number) => {
    setCursor(newCursor);
    setScrollOffset((prev) => {
      if (newCursor < prev) return newCursor;
      if (newCursor >= prev + VISIBLE_ROWS) return newCursor - VISIBLE_ROWS + 1;
      return prev;
    });
  }, []);

  const toggleToken = useCallback((alias: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const upper = alias.toUpperCase();
      if (next.has(upper)) {
        next.delete(upper);
      } else {
        next.add(upper);
      }
      return next;
    });
  }, []);

  const handleConfirm = useCallback(() => {
    const result: string[] = [];
    for (const entry of registry) {
      if (selected.has(entry.alias.toUpperCase())) {
        result.push(entry.alias);
      }
    }
    for (const ct of customTokens) {
      if (selected.has(ct.toUpperCase())) {
        result.push(ct);
      }
    }
    onConfirm(result);
  }, [registry, customTokens, selected, onConfirm]);

  const handleDiscoverToken = useCallback(
    (coinType: string) => {
      setPhase('discovering');
      setDiscoverError(null);
      coinMetadataService
        .getMetadata(coinType, 'sui')
        .then((meta) => {
          if (!mountedRef.current) return;
          setDiscovered({
            symbol: meta.symbol !== '' ? meta.symbol : extractTokenSymbol(coinType),
            decimals: meta.decimals,
            coinType: meta.coinType,
          });
          setPhase('custom-confirm');
        })
        .catch((err: unknown) => {
          if (!mountedRef.current) return;
          setDiscoverError(toErrorMessage(err));
          setPhase('custom-input');
        });
    },
    [coinMetadataService],
  );

  const handleAddDiscoveredToken = useCallback(() => {
    if (discovered === null) return;
    const symbol = discovered.symbol;
    const upper = symbol.toUpperCase();

    setSelected((prev) => new Set([...prev, upper]));

    if (!REGISTRY_ALIASES_UPPER.has(upper)) {
      setCustomTokens((prev) => {
        if (prev.some((ct) => ct.toUpperCase() === upper)) return prev;
        return [...prev, symbol];
      });
    }

    setPhase('list');
    setDiscovered(null);
  }, [discovered]);

  // ── Input handling ──────────────────────────────────────────────────

  useInput((input, key) => {
    if (phase === 'list') {
      if (key.upArrow) {
        ensureVisible(Math.max(0, cursor - 1));
      } else if (key.downArrow) {
        ensureVisible(Math.min(items.length - 1, cursor + 1));
      } else if (input === ' ') {
        const item = items[cursor];
        if (item?.kind === 'token') {
          toggleToken(item.alias);
        }
      } else if (key.return) {
        const item = items[cursor];
        if (item?.kind === 'add-custom') {
          setPhase('custom-input');
          setCustomInput('');
          setDiscoverError(null);
        } else {
          handleConfirm();
        }
      } else if (key.escape) {
        if (filter !== '') {
          setFilter('');
        } else {
          onCancel();
        }
      } else if (key.backspace || key.delete) {
        setFilter((prev) => prev.slice(0, -1));
      } else if (input !== '' && !key.ctrl && !key.meta) {
        setFilter((prev) => prev + input);
      }
    } else if (phase === 'custom-input') {
      if (key.return && customInput.trim() !== '') {
        handleDiscoverToken(customInput.trim());
      } else if (key.escape) {
        setPhase('list');
      } else if (key.backspace || key.delete) {
        setCustomInput((prev) => prev.slice(0, -1));
      } else if (input !== '' && !key.ctrl && !key.meta) {
        setCustomInput((prev) => prev + input);
      }
    } else if (phase === 'custom-confirm') {
      if (input === 'y' || key.return) {
        handleAddDiscoveredToken();
      } else if (input === 'n' || key.escape) {
        setPhase('list');
        setDiscovered(null);
      }
    }
    // phase === 'discovering': all input ignored
  });

  // ── Render ──────────────────────────────────────────────────────────

  if (phase === 'custom-input') {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.highlight} paddingX={1}>
        <Text color={theme.highlight} bold>
          {'Add Custom Coin Type'}
        </Text>
        <Text color={theme.muted}>{'Paste the full coin type (e.g., 0x...::module::TYPE)'}</Text>
        <Box marginTop={1}>
          <Text color={theme.body}>{'> '}</Text>
          <Text color={theme.eyes}>{customInput}</Text>
          <Text color={theme.highlight} bold>
            {'▎'}
          </Text>
        </Box>
        {discoverError !== null && (
          <Box marginTop={1}>
            <Text color={theme.error}>{`Error: ${discoverError}`}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text color={theme.muted}>{'Enter: discover    Esc: back'}</Text>
        </Box>
      </Box>
    );
  }

  if (phase === 'discovering') {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.highlight} paddingX={1}>
        <Text color={theme.highlight} bold>
          {'Discovering Token...'}
        </Text>
        <Text color={theme.muted}>{'Looking up metadata for:'}</Text>
        <Text color={theme.eyes}>{customInput}</Text>
      </Box>
    );
  }

  if (phase === 'custom-confirm' && discovered !== null) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.highlight} paddingX={1}>
        <Text color={theme.success} bold>
          {'Token Found'}
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.eyes}>{`Symbol:    ${discovered.symbol}`}</Text>
          <Text color={theme.eyes}>{`Decimals:  ${discovered.decimals}`}</Text>
          <Text color={theme.eyes}>{`Coin Type: ${discovered.coinType}`}</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={theme.muted}>{'y/Enter: add token    n/Esc: cancel'}</Text>
        </Box>
      </Box>
    );
  }

  // ── List view ───────────────────────────────────────────────────────

  const visible = items.slice(scrollOffset, scrollOffset + VISIBLE_ROWS);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.highlight} paddingX={1}>
      <Box>
        <Text color={theme.highlight} bold>
          {'Select Allowed Tokens'}
        </Text>
        <Text color={theme.muted}>{`  (${selected.size} selected)`}</Text>
      </Box>

      <Box>
        <Text color={theme.body}>{'Filter: '}</Text>
        <Text color={theme.eyes}>{filter}</Text>
        <Text color={theme.highlight} bold>
          {'▎'}
        </Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {scrollOffset > 0 && <Text color={theme.muted}>{'  ↑ more above'}</Text>}

        {visible.map((item, i) => {
          const idx = scrollOffset + i;
          const isHighlighted = idx === cursor;
          const prefix = isHighlighted ? '>' : ' ';

          if (item.kind === 'add-custom') {
            return (
              <Box key="__add_custom__">
                <Text color={isHighlighted ? theme.highlight : theme.muted}>{`${prefix} `}</Text>
                <Text color={theme.warning}>{'[+] '}</Text>
                <Text color={isHighlighted ? theme.highlight : theme.eyes}>
                  {'Add custom coin type...'}
                </Text>
              </Box>
            );
          }

          const isSelected = selected.has(item.alias.toUpperCase());
          const checkbox = isSelected ? '[x]' : '[ ]';
          const detail = item.isCustom ? '(custom)' : shortCoinType(item.coinType);

          return (
            <Box key={item.alias + (item.isCustom ? '__custom' : '')}>
              <Text color={isHighlighted ? theme.highlight : theme.muted}>{`${prefix} `}</Text>
              <Text color={isSelected ? theme.success : theme.muted}>{`${checkbox} `}</Text>
              <Box width={12}>
                <Text color={isHighlighted ? theme.highlight : theme.eyes}>{item.alias}</Text>
              </Box>
              <Text color={theme.muted} dimColor>
                {detail}
              </Text>
            </Box>
          );
        })}

        {scrollOffset + VISIBLE_ROWS < items.length && (
          <Text color={theme.muted}>{'  ↓ more below'}</Text>
        )}
      </Box>

      <Box marginTop={1}>
        <Text color={theme.muted}>
          {`Space toggle  ↑↓ move  Enter confirm  Esc ${filter !== '' ? 'clear' : 'cancel'}`}
        </Text>
      </Box>
    </Box>
  );
}
