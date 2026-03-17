import { Box, Text, useInput } from 'ink';
import { useState, useEffect, useCallback } from 'react';
import type { ReactElement } from 'react';
import { theme } from '../theme.js';
import { useTui } from '../context.js';
import { TextInput } from '../components/TextInput.js';
import { updateConfigFile } from '../../config/loader.js';
import { setNestedValue } from '../../config/utils.js';
import { toErrorMessage } from '../../utils/index.js';

const FIELD_LABELS = [
  'RPC Endpoint',
  'Max Single Trade (USD)',
  'Max 24h Volume (USD)',
  'Allowed Tokens (comma-separated)',
] as const;

export function PolicyConfig(): ReactElement {
  const { config, activeChain, reloadConfig, mode, setMode } = useTui();

  const chainConfig = config.chain[activeChain];

  // Editable field values
  const [rpc, setRpc] = useState(chainConfig?.rpc ?? '');
  const [maxSingleTrade, setMaxSingleTrade] = useState(
    String(chainConfig?.limits?.max_single_trade ?? 200),
  );
  const [max24hVolume, setMax24hVolume] = useState(
    String(chainConfig?.limits?.max_24h_volume ?? 500),
  );
  const [tokens, setTokens] = useState((chainConfig?.allowlist?.tokens ?? []).join(', '));

  // UI state
  const [selectedField, setSelectedField] = useState(0);
  const [editValue, setEditValue] = useState('');
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  // Sync local state when config changes externally
  useEffect(() => {
    const cc = config.chain[activeChain];
    setRpc(cc?.rpc ?? '');
    setMaxSingleTrade(String(cc?.limits?.max_single_trade ?? 200));
    setMax24hVolume(String(cc?.limits?.max_24h_volume ?? 500));
    setTokens((cc?.allowlist?.tokens ?? []).join(', '));
    setDirty(false);
    setStatus(null);
  }, [config, activeChain]);

  // Get current value for a field index
  const getFieldValue = useCallback(
    (index: number): string => {
      switch (index) {
        case 0:
          return rpc;
        case 1:
          return maxSingleTrade;
        case 2:
          return max24hVolume;
        case 3:
          return tokens;
        default:
          return '';
      }
    },
    [rpc, maxSingleTrade, max24hVolume, tokens],
  );

  const startEditing = useCallback(() => {
    setEditValue(getFieldValue(selectedField));
    setMode('edit');
  }, [selectedField, getFieldValue, setMode]);

  const confirmEdit = useCallback(() => {
    switch (selectedField) {
      case 0:
        setRpc(editValue);
        break;
      case 1:
        setMaxSingleTrade(editValue);
        break;
      case 2:
        setMax24hVolume(editValue);
        break;
      case 3:
        setTokens(editValue);
        break;
    }
    setDirty(true);
    setMode('navigate');
    setStatus({ kind: 'success', text: 'Modified (press s to save)' });
  }, [selectedField, editValue, setMode]);

  const cancelEdit = useCallback(() => {
    setMode('navigate');
    setStatus(null);
  }, [setMode]);

  const saveConfig = useCallback(() => {
    try {
      // Validate numeric fields before saving
      const parsedSingle = parseFloat(maxSingleTrade);
      const parsed24h = parseFloat(max24hVolume);
      if (!Number.isFinite(parsedSingle) || parsedSingle <= 0) {
        setStatus({ kind: 'error', text: 'Max Single Trade must be a positive number' });
        return;
      }
      if (!Number.isFinite(parsed24h) || parsed24h <= 0) {
        setStatus({ kind: 'error', text: 'Max 24h Volume must be a positive number' });
        return;
      }

      const parsedTokens = tokens
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      if (parsedTokens.length === 0) {
        setStatus({ kind: 'error', text: 'At least one token must be in the allowlist' });
        return;
      }

      updateConfigFile((raw) => {
        setNestedValue(raw, `chain.${activeChain}.rpc`, rpc);
        setNestedValue(raw, `chain.${activeChain}.limits.max_single_trade`, parsedSingle);
        setNestedValue(raw, `chain.${activeChain}.limits.max_24h_volume`, parsed24h);
        setNestedValue(raw, `chain.${activeChain}.allowlist.tokens`, parsedTokens);
      });

      reloadConfig();
      setDirty(false);
      setStatus({ kind: 'success', text: 'Saved successfully' });
    } catch (err: unknown) {
      setStatus({ kind: 'error', text: toErrorMessage(err) });
    }
  }, [activeChain, rpc, maxSingleTrade, max24hVolume, tokens, reloadConfig]);

  // Navigation mode: field selection + save shortcut
  useInput(
    (input, key) => {
      if (key.upArrow) {
        setSelectedField((f) => Math.max(0, f - 1));
      } else if (key.downArrow) {
        setSelectedField((f) => Math.min(FIELD_LABELS.length - 1, f + 1));
      } else if (key.return) {
        startEditing();
      } else if (input === 's' && dirty) {
        saveConfig();
      }
    },
    { isActive: mode === 'navigate' },
  );

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text color={theme.highlight} bold>
          {'Policy Configuration'}
        </Text>
        <Text color={theme.muted}>{`  ─  Chain: ${activeChain}`}</Text>
        {dirty && <Text color={theme.warning}>{' [Modified]'}</Text>}
      </Box>

      <Box flexDirection="column" borderStyle="single" borderColor={theme.shadow} paddingX={1}>
        {FIELD_LABELS.map((label, i) => {
          const isSelected = i === selectedField;
          const isEditing = mode === 'edit' && isSelected;
          const value = getFieldValue(i);

          return (
            <Box key={label}>
              <Text color={isSelected ? theme.highlight : theme.muted}>
                {isSelected ? ' > ' : '   '}
              </Text>
              <Box width={32}>
                <Text color={theme.body} bold>
                  {label}
                </Text>
              </Box>
              <Box flexGrow={1}>
                {isEditing ? (
                  <TextInput
                    value={editValue}
                    onChange={setEditValue}
                    onSubmit={confirmEdit}
                    onCancel={cancelEdit}
                  />
                ) : (
                  <Text color={theme.eyes}>{value !== '' ? value : '-'}</Text>
                )}
              </Box>
            </Box>
          );
        })}
      </Box>

      {/* Current config summary */}
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor={theme.shadow}
        paddingX={1}
        marginTop={1}
      >
        <Text color={theme.body} bold>
          {'Current Config (on disk)'}
        </Text>
        <Text color={theme.eyes}>{`RPC:              ${chainConfig?.rpc ?? '-'}`}</Text>
        <Text color={theme.eyes}>
          {`Max Single Trade: ${chainConfig?.limits !== undefined ? `$${chainConfig.limits.max_single_trade}` : '-'}`}
        </Text>
        <Text color={theme.eyes}>
          {`Max 24h Volume:   ${chainConfig?.limits !== undefined ? `$${chainConfig.limits.max_24h_volume}` : '-'}`}
        </Text>
        <Text color={theme.eyes}>
          {`Tokens:           ${chainConfig?.allowlist?.tokens.join(', ') ?? '-'}`}
        </Text>
      </Box>

      {status !== null && (
        <Box marginTop={1}>
          <Text color={status.kind === 'error' ? theme.error : theme.success}>{status.text}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={theme.muted}>{'  ↑↓ Select    Enter Edit    Esc Cancel    s Save'}</Text>
      </Box>
    </Box>
  );
}
