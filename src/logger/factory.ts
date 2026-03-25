import pino from 'pino';
import type { Logger } from 'pino';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { ONLYFENCE_DIR } from '../config/loader.js';
import { SECURE_DIR_MODE } from '../security/file-permissions.js';
import { REDACT_PATHS } from './sensitive.js';

export type { Logger } from 'pino';

/**
 * Options for creating the application logger.
 */
export interface LoggerOptions {
  readonly verbose: boolean;
  readonly logDir?: string;
}

const DEFAULT_LOG_DIR = join(ONLYFENCE_DIR, 'logs');

let _logger: Logger | undefined;

/**
 * Create and cache the process-wide pino logger.
 *
 * - Always writes structured JSON to a daily-rotated log file.
 * - When `verbose` is true, also writes human-readable output to stderr.
 *
 * @param options - Logger configuration
 * @returns The initialized pino Logger
 */
export function createLogger(options: LoggerOptions): Logger {
  if (_logger !== undefined) {
    return _logger;
  }

  const logDir = options.logDir ?? DEFAULT_LOG_DIR;

  // Create the log directory with secure permissions (0o700) before pino-roll
  // does — pino-roll's mkdir uses default umask, resulting in 0o755.
  mkdirSync(logDir, { recursive: true, mode: SECURE_DIR_MODE });

  const targets: pino.TransportTargetOptions[] = [
    {
      target: 'pino-roll',
      options: {
        file: join(logDir, 'fence'),
        frequency: 'daily',
        extension: '.log',
        limit: { count: 30 },
        mkdir: false,
      },
      level: 'info',
    },
  ];

  if (options.verbose) {
    targets.push({
      target: 'pino/file',
      options: { destination: 2 }, // stderr
      level: 'debug',
    });
  }

  _logger = pino({
    level: options.verbose ? 'debug' : 'info',
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
    base: { app: 'onlyfence', pid: process.pid },
    redact: {
      paths: [...REDACT_PATHS],
      censor: '[REDACTED]',
    },
    transport: { targets },
  });

  return _logger;
}

/**
 * Retrieve the cached logger. Throws if `createLogger` has not been called.
 */
export function getLogger(): Logger {
  if (_logger === undefined) {
    throw new Error('Logger not initialized. Call createLogger() first.');
  }
  return _logger;
}

/**
 * Check whether the logger has been initialized.
 */
export function hasLogger(): boolean {
  return _logger !== undefined;
}
