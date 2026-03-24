import { Box, Text } from 'ink';
import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import { runStartupChecks, type StartupWarning } from '../../security/index.js';
import { isDaemonRunning } from '../../daemon/pid-manager.js';
import { readPidFile } from '../../daemon/pid-manager.js';
import { Panel } from '../components/Panel.js';
import { theme } from '../theme.js';

/**
 * Security Status screen showing the current security posture.
 *
 * Displays: deployment tier, file permissions status, process hardening,
 * active policy checks, trust boundaries, and startup warnings.
 */
export function SecurityStatus(): ReactElement {
  const [warnings, setWarnings] = useState<StartupWarning[]>([]);
  const [daemonRunning, setDaemonRunning] = useState(false);
  const [daemonPid, setDaemonPid] = useState<number | null>(null);
  const [isRoot, setIsRoot] = useState(false);

  useEffect(() => {
    setWarnings(runStartupChecks());
    setDaemonRunning(isDaemonRunning());
    setDaemonPid(readPidFile());
    setIsRoot(typeof process.getuid === 'function' && process.getuid() === 0);
  }, []);

  const tier = daemonRunning ? 'Tier 1 (Daemon)' : 'Tier 0 (Standalone)';
  const passedChecks = warnings.length === 0;

  return (
    <Panel title="Security Status">
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>{'Deployment'}</Text>
          <Text>{`  Tier:        ${tier}`}</Text>
          {daemonRunning && daemonPid !== null && (
            <Text>{`  Daemon PID:  ${String(daemonPid)}`}</Text>
          )}
        </Box>

        <Box flexDirection="column">
          <Text bold>{'Protections'}</Text>
          <Text color={daemonRunning ? theme.success : theme.warning}>
            {daemonRunning
              ? '  ✓  Keys in daemon memory (not on disk during operation)'
              : '  ⚠  Keys held in session file on disk'}
          </Text>
          <Text color={daemonRunning ? theme.success : theme.warning}>
            {daemonRunning
              ? '  ✓  Config snapshot immutable since daemon start'
              : '  ⚠  Config editable by any local process'}
          </Text>
          <Text color={daemonRunning ? theme.success : theme.warning}>
            {daemonRunning
              ? '  ✓  Trade history exclusive lock held by daemon'
              : '  ⚠  Trade history writable by local processes'}
          </Text>
        </Box>

        <Box flexDirection="column">
          <Text bold>{'Trust Boundary'}</Text>
          {isRoot ? (
            <Box flexDirection="column">
              <Text color={theme.error}>{'  ✖  ROOT ACCESS — ALL protections are bypassed'}</Text>
              <Text color={theme.error}>
                {'     Root can: read keystore, session, socket, and daemon memory'}
              </Text>
            </Box>
          ) : daemonRunning ? (
            <Box flexDirection="column">
              <Text color={theme.success}>
                {'  ✓  Same-user agents can execute trades (within policy limits)'}
              </Text>
              <Text color={theme.success}>
                {'  ✓  Same-user agents CANNOT extract private keys'}
              </Text>
              <Text color={theme.warning}>
                {'  ⚠  Root/sudo access would bypass all protections'}
              </Text>
            </Box>
          ) : (
            <Box flexDirection="column">
              <Text color={theme.error}>
                {'  ✖  Same-user agents CAN extract private keys from session file'}
              </Text>
              <Text color={theme.warning}>
                {'  ⚠  Root/sudo access would bypass all protections'}
              </Text>
            </Box>
          )}
        </Box>

        {warnings.length > 0 && (
          <Box flexDirection="column">
            <Text bold>{'Warnings'}</Text>
            {warnings.map((w, i) => (
              <Box key={i} flexDirection="column">
                <Text color={w.level === 'error' ? theme.error : theme.warning}>
                  {`  ${w.level === 'error' ? '✖' : '⚠'}  ${w.message}`}
                </Text>
                <Text dimColor>{`     Fix: ${w.fix}`}</Text>
              </Box>
            ))}
          </Box>
        )}

        {passedChecks && <Text color={theme.success}>{'  ✓  All security checks passed'}</Text>}

        {!daemonRunning && (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>{'  To upgrade security, run: fence start'}</Text>
          </Box>
        )}
      </Box>
    </Panel>
  );
}
