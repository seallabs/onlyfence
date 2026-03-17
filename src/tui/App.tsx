import { Box, Text, useInput, useApp } from 'ink';
import { useState, useCallback, useMemo } from 'react';
import type { ReactElement } from 'react';
import type { AppComponents } from '../cli/bootstrap.js';
import type { UpdateChecker } from '../update/checker.js';
import { CURRENT_VERSION } from '../update/index.js';
import { loadConfig } from '../config/loader.js';
import { toErrorMessage } from '../utils/index.js';
import { theme } from './theme.js';
import { TuiProvider } from './context.js';
import type { TuiContextValue } from './context.js';
import { Header } from './components/Header.js';
import { UpdateBanner } from './components/UpdateBanner.js';
import { Dashboard } from './screens/Dashboard.js';
import { TradeHistory } from './screens/TradeHistory.js';
import { PolicyConfig } from './screens/PolicyConfig.js';
import { WalletInfo } from './screens/WalletInfo.js';
import { useUpdateCheck } from './hooks/useUpdateCheck.js';

interface AppProps {
  readonly components: AppComponents;
  readonly updateChecker: UpdateChecker;
}

/**
 * Root TUI application component.
 *
 * Manages tab navigation, input mode, config reloading, and update status.
 * Provides TuiContext to all child screens.
 */
export function App({ components, updateChecker }: AppProps): ReactElement {
  const { exit } = useApp();

  const [activeTab, setActiveTab] = useState(0);
  const [config, setConfig] = useState(components.config);
  const [configError, setConfigError] = useState<string | null>(null);
  const [mode, setMode] = useState<'navigate' | 'edit'>('navigate');

  const { db, oracle, tradeLog, policyRegistry, chainAdapterFactory } = components;

  const activeChain = Object.keys(config.chain)[0] ?? 'sui';
  const activeChainId = chainAdapterFactory.get(activeChain).chainId;

  const updateStatus = useUpdateCheck(updateChecker, CURRENT_VERSION);

  const reloadConfig = useCallback(() => {
    try {
      const newConfig = loadConfig();
      setConfig(newConfig);
      setConfigError(null);
    } catch (err: unknown) {
      setConfigError(toErrorMessage(err));
    }
  }, []);

  // Global keyboard shortcuts — only active in navigate mode
  useInput(
    (input, _key) => {
      switch (input) {
        case '1':
          setActiveTab(0);
          break;
        case '2':
          setActiveTab(1);
          break;
        case '3':
          setActiveTab(2);
          break;
        case '4':
          setActiveTab(3);
          break;
        case 'q':
          exit();
          break;
        case 'r':
          reloadConfig();
          break;
      }
    },
    { isActive: mode === 'navigate' },
  );

  const ctx: TuiContextValue = useMemo(
    () => ({
      db,
      oracle,
      tradeLog,
      policyRegistry,
      chainAdapterFactory,
      config,
      activeChain,
      activeChainId,
      reloadConfig,
      configError,
      mode,
      setMode,
      updateStatus,
    }),
    [
      db,
      oracle,
      tradeLog,
      policyRegistry,
      chainAdapterFactory,
      config,
      activeChain,
      activeChainId,
      reloadConfig,
      configError,
      mode,
      updateStatus,
    ],
  );

  return (
    <TuiProvider value={ctx}>
      <Box flexDirection="column">
        <Header activeTab={activeTab} />
        <UpdateBanner status={updateStatus} />
        {configError !== null && (
          <Box paddingX={1}>
            <Text color={theme.error}>{`Config error: ${configError}`}</Text>
          </Box>
        )}
        {activeTab === 0 && <Dashboard />}
        {activeTab === 1 && <TradeHistory />}
        {activeTab === 2 && <PolicyConfig />}
        {activeTab === 3 && <WalletInfo />}
      </Box>
    </TuiProvider>
  );
}
