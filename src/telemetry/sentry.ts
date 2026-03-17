import * as Sentry from '@sentry/node';
import type { TelemetryConfig } from '../types/config.js';
import { scrubSensitiveData } from './scrubber.js';
import { CURRENT_VERSION } from '../update/index.js';

let initialized = false;

/**
 * Initialize Sentry error reporting if telemetry is enabled.
 *
 * Does nothing when `config.enabled` is false or `config.dsn` is absent.
 * Sensitive data is stripped via `beforeSend` hook.
 */
export function initSentry(config: TelemetryConfig): void {
  if (!config.enabled || config.dsn === undefined) {
    return;
  }

  Sentry.init({
    dsn: config.dsn,
    beforeSend(event) {
      return scrubSensitiveData(event) as Sentry.ErrorEvent;
    },
    sendDefaultPii: false,
    environment: 'production',
    release: `onlyfence@${CURRENT_VERSION}`,
  });

  initialized = true;
}

/**
 * Report an exception to Sentry (no-op if not initialized).
 */
export function captureException(err: unknown): void {
  if (!initialized) {
    return;
  }
  Sentry.captureException(err);
}

/**
 * Flush pending Sentry events and shut down the client.
 * Waits up to 2 seconds for events to drain.
 */
export async function closeSentry(): Promise<void> {
  if (!initialized) {
    return;
  }
  await Sentry.close(2000);
}
