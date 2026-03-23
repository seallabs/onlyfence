import { Box, Text, useApp, useInput } from 'ink';
import type { ReactElement } from 'react';
import { useCallback, useMemo, useState } from 'react';
import type { AppComponents } from '../cli/bootstrap.js';
import { loadConfig } from '../config/loader.js';
import type { Chain } from '../core/action-types.js';
import type { UpdateChecker } from '../update/checker.js';
import { CURRENT_VERSION } from '../update/index.js';
import { toErrorMessage } from '../utils/index.js';
import { Header } from './components/Header.js';
import { UpdateBanner } from './components/UpdateBanner.js';
import type { TuiContextValue } from './context.js';
import { TuiProvider } from './context.js';
import { useUpdateCheck } from './hooks/useUpdateCheck.js';
import { Dashboard } from './screens/Dashboard.js';
import { PolicyConfig } from './screens/PolicyConfig.js';
import { TradeHistory } from './screens/TradeHistory.js';
import { WalletInfo } from './screens/WalletInfo.js';
import { theme } from './theme.js';

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

  const { db, dataProviders, activityLog, policyRegistry, chainAdapterFactory } = components;

  const activeChain: Chain = Object.keys(config.chain)[0] as Chain;
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

  const dataProvider = dataProviders.get(activeChain);

  const ctx: TuiContextValue = useMemo(
    () => ({
      db,
      dataProvider,
      activityLog,
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
      dataProvider,
      activityLog,
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
