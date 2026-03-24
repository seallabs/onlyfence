/**
 * Daemon lifecycle orchestrator.
 *
 * Manages the full daemon lifecycle: password prompt → key decryption →
 * bootstrap → config snapshot → server start → signal handling → shutdown.
 */

import { readFileSync } from 'node:fs';
import type { ChainId } from '../core/action-types.js';
import { toErrorMessage } from '../utils/index.js';
import { trySetNondumpable, tryDenyAttach } from '../security/process-hardening.js';
import { isRunningAsRoot } from '../security/index.js';
import type { AppConfig } from '../types/config.js';
import { bootstrap } from '../cli/bootstrap.js';
import { createLogger, getLogger, hasLogger } from '../logger/index.js';
import { ConfigSnapshot } from './config-snapshot.js';
import { DaemonExecutor } from './executor.js';
import { DaemonServer, type DaemonServerOptions } from './server.js';
import { KeyHolder } from './key-holder.js';
import { InMemoryTradeWindow } from './trade-window.js';
import { writePidFile, removePidFile } from './pid-manager.js';
import { SOCKET_PATH } from './detect.js';
import type { IpcRequest, IpcResponse, TradePayload, ReloadPayload } from './protocol.js';
import type { SecurePassword } from '../security/branded-types.js';
import {
  securePasswordFromEnv,
  securePasswordFromFile,
  securePasswordFromStdin,
} from '../security/branded-types.js';

export interface DaemonOptions {
  /** Password obtained through a secure channel (branded type prevents raw strings). */
  readonly password?: SecurePassword;
  readonly passwordFile?: string;
  readonly tcpHost?: string;
  readonly tcpPort?: number;
  readonly allowRemote?: boolean;
  readonly detach?: boolean;
}

/** Default TCP port for daemon. */
const DEFAULT_TCP_PORT = 19876;

/**
 * Start the OnlyFence daemon in foreground mode.
 *
 * This function does not return until the daemon is stopped.
 */
export async function startDaemon(options: DaemonOptions): Promise<void> {
  if (!hasLogger()) {
    createLogger({ verbose: false });
  }
  const logger = getLogger();

  // PR_SET_DUMPABLE and file permissions do NOT protect against root (CAP_SYS_PTRACE).
  if (isRunningAsRoot()) {
    process.stderr.write(
      '\n' +
        '╔══════════════════════════════════════════════════════════════════╗\n' +
        '║  CRITICAL: Daemon running as root                              ║\n' +
        '║                                                                ║\n' +
        '║  Root bypasses ALL security controls:                          ║\n' +
        '║    - File permissions (0o600) are ignored                      ║\n' +
        '║    - PR_SET_DUMPABLE does not block root (CAP_SYS_PTRACE)     ║\n' +
        '║    - Socket restrictions do not apply                          ║\n' +
        '║    - Any root process can ptrace this daemon and read keys     ║\n' +
        '║                                                                ║\n' +
        '║  Never grant root/sudo access to AI agents or untrusted code. ║\n' +
        '╚══════════════════════════════════════════════════════════════════╝\n\n',
    );
    logger.error('Daemon started as root — all process hardening is ineffective against root');
  }

  const nondumpable = trySetNondumpable();
  const denyAttach = tryDenyAttach();
  if (nondumpable) logger.info('PR_SET_DUMPABLE=0 applied');
  if (denyAttach) logger.info('PT_DENY_ATTACH applied');

  const password = await resolvePassword(options);
  logger.info('Password resolved');

  const keyHolder = KeyHolder.fromPassword(password);
  logger.info('Keystore decrypted, keys held in memory');

  const components = bootstrap();
  logger.info('Bootstrap complete');

  const configSnapshot = new ConfigSnapshot(components.config);
  logger.info({ configHash: configSnapshot.configHash }, 'Config snapshot created');

  const tradeWindow = new InMemoryTradeWindow();
  const chainIds = Object.keys(components.config.chain).map((c) => `${c}:mainnet`);
  tradeWindow.preload(components.activityLog, chainIds);
  logger.info('In-memory trade window initialized');

  const executor = new DaemonExecutor(components, keyHolder, configSnapshot, tradeWindow, logger);

  const serverOptions: DaemonServerOptions = {
    socketPath: SOCKET_PATH,
    tcpHost: options.tcpHost ?? '127.0.0.1',
    tcpPort: options.tcpPort ?? DEFAULT_TCP_PORT,
    allowRemote: options.allowRemote ?? false,
  };

  const server = new DaemonServer(serverOptions);

  // Reload lockout state: prevents brute-forcing the password via the
  // reload endpoint, which would otherwise act as a password oracle.
  let reloadFailures = 0;
  let reloadLockedUntil = 0;
  const RELOAD_MAX_FAILURES = 3;
  const RELOAD_LOCKOUT_BASE_MS = 30_000; // 30s, doubles each lockout

  // Request handler
  const handleRequest = async (req: IpcRequest): Promise<IpcResponse> => {
    switch (req.type) {
      case 'trade': {
        const result = await executor.executeTrade(req.payload as TradePayload);
        const ok = result.status === 'success' || result.status === 'simulated';
        return {
          id: req.id,
          ok,
          data: { result },
          ...(!ok && result.error !== undefined ? { error: result.error } : {}),
          ...(!ok && result.rejectionReason !== undefined ? { error: result.rejectionReason } : {}),
        };
      }
      case 'status': {
        const volumes: Record<string, number> = {};
        for (const cid of chainIds) {
          volumes[cid] = tradeWindow.getRolling24hVolume(cid as ChainId);
        }
        return {
          id: req.id,
          ok: true,
          data: {
            pid: process.pid,
            uptime: process.uptime(),
            tier: 'daemon',
            configHash: configSnapshot.configHash,
            rolling24hVolume: volumes,
            connections: server.activeConnections,
          },
        };
      }
      case 'reload': {
        // Lockout check: prevent brute-force password guessing
        const now = Date.now();
        if (now < reloadLockedUntil) {
          const remainingSec = Math.ceil((reloadLockedUntil - now) / 1000);
          logger.warn({ remainingSec }, 'Reload attempt during lockout');
          return {
            id: req.id,
            ok: false,
            error: `Reload locked out for ${String(remainingSec)}s after ${String(RELOAD_MAX_FAILURES)} failed attempts.`,
          };
        }

        const { password: reloadPwd } = req.payload as ReloadPayload;
        try {
          const newHash = configSnapshot.reload(reloadPwd);
          reloadFailures = 0; // Reset on success
          logger.info({ configHash: newHash }, 'Config reloaded');
          return { id: req.id, ok: true, data: { configHash: newHash } };
        } catch {
          reloadFailures++;
          logger.warn({ failures: reloadFailures }, 'Reload failed (wrong password)');

          if (reloadFailures >= RELOAD_MAX_FAILURES) {
            // Exponential lockout: 30s, 60s, 120s, ...
            const lockoutMs =
              RELOAD_LOCKOUT_BASE_MS *
              Math.pow(2, Math.floor(reloadFailures / RELOAD_MAX_FAILURES) - 1);
            reloadLockedUntil = Date.now() + lockoutMs;
            logger.warn({ lockoutMs }, 'Reload locked out due to repeated failures');
          }

          return {
            id: req.id,
            ok: false,
            error: 'Invalid password.',
          };
        }
      }
      case 'stop': {
        logger.info('Stop request received');
        // Schedule shutdown on next tick so the response is sent first
        setImmediate(() => {
          void shutdown();
        });
        return { id: req.id, ok: true };
      }
      default:
        return { id: req.id, ok: false, error: `Unknown request type: ${String(req.type)}` };
    }
  };

  try {
    await server.start(handleRequest);
  } catch (err: unknown) {
    keyHolder.destroy();
    components.close();
    const msg = toErrorMessage(err);
    if (msg.includes('EADDRINUSE')) {
      throw new Error(
        `Cannot start daemon: port ${String(serverOptions.tcpPort)} is already in use.\n` +
          `  A previous daemon may still be running.\n\n` +
          `  To fix:\n` +
          `    fence stop                        Stop the existing daemon\n` +
          `    lsof -ti tcp:${String(serverOptions.tcpPort)} | xargs kill   Kill the process holding the port`,
      );
    }
    throw err;
  }

  writePidFile();

  // Signal parent (detached mode) that daemon is ready, then disconnect IPC
  if (typeof process.send === 'function') {
    const { DAEMON_READY_MSG } = await import('./protocol.js');
    process.send({ type: DAEMON_READY_MSG, pid: process.pid });
    if (typeof process.disconnect === 'function') {
      process.disconnect();
    }
  }

  printStartupSummary(serverOptions, configSnapshot.configHash, components.config);

  async function shutdown(): Promise<void> {
    logger.info('Shutting down daemon...');
    await server.stop();
    keyHolder.destroy();
    components.close();
    removePidFile();
    logger.info('Daemon stopped');
    process.exit(0);
  }

  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });

  // Keep the process alive
  await new Promise(() => {
    // This promise never resolves — daemon runs until signal
  });
}

async function resolvePassword(options: DaemonOptions): Promise<SecurePassword> {
  // Each branch returns a branded SecurePassword — plain strings won't compile.
  // This ensures every password source is explicitly marked as a secure channel.

  if (options.password !== undefined && options.password.length > 0) {
    return options.password; // Already branded by caller
  }

  const passwordFile = options.passwordFile ?? process.env['FENCE_PASSWORD_FILE'];
  if (passwordFile !== undefined && passwordFile.length > 0) {
    return securePasswordFromFile(readFileSync(passwordFile, 'utf-8').trim());
  }

  const envPassword = securePasswordFromEnv('FENCE_PASSWORD');
  if (envPassword !== undefined) {
    return envPassword; // Env var already deleted by securePasswordFromEnv
  }

  if (!process.stdin.isTTY) {
    const stdinValue = await readStdinLine();
    if (stdinValue.length > 0) {
      return securePasswordFromStdin(stdinValue);
    }
  }

  throw new Error(
    'Password required to start the daemon.\n' +
      '  Provide via: FENCE_PASSWORD_FILE env var, or interactive prompt.',
  );
}

/** Read a single line from stdin (for pipe-based password passing). */
function readStdinLine(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk: string) => {
      data += chunk;
      const nlIndex = data.indexOf('\n');
      if (nlIndex !== -1) {
        resolve(data.slice(0, nlIndex).trim());
        process.stdin.destroy();
      }
    });
    process.stdin.on('end', () => {
      resolve(data.trim());
    });
    // Timeout after 5s to avoid hanging
    setTimeout(() => {
      resolve(data.trim());
      process.stdin.destroy();
    }, 5000);
    process.stdin.resume();
  });
}

function printStartupSummary(
  opts: DaemonServerOptions,
  configHash: string,
  config: AppConfig,
): void {
  const chains = Object.keys(config.chain).join(', ');
  process.stderr.write(
    `OnlyFence Daemon started\n` +
      `  PID:       ${String(process.pid)}\n` +
      `  Socket:    ${opts.socketPath}\n` +
      `  TCP:       ${opts.tcpHost}:${String(opts.tcpPort)}\n` +
      `  Config:    ${configHash}\n` +
      `  Chains:    ${chains}\n\n`,
  );
}

export { DaemonClient } from './client.js';
export { detectExecutionMode, type ExecutionMode } from './detect.js';
export { isDaemonRunning } from './pid-manager.js';
export { stopDaemonGracefully, type StopResult } from './stop-helper.js';
