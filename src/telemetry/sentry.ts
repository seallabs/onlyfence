import * as Sentry from '@sentry/node';
import { scrubSensitiveData } from './scrubber.js';
import { CURRENT_VERSION } from '../update/index.js';

// TODO: Replace with actual Sentry DSN before release
const SENTRY_DSN = 'https://TODO@o000000.ingest.us.sentry.io/0000000';

let initialized = false;

/**
 * Initialize Sentry error reporting if telemetry is enabled.
 *
 * The DSN is embedded in the binary — users only control the `enabled` flag.
 * Sensitive data is stripped via `beforeSend` hook.
 */
export function initSentry(enabled: boolean): void {
  if (!enabled) {
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
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
