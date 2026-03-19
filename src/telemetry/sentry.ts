import * as Sentry from '@sentry/node';
import { scrubSensitiveData } from './scrubber.js';
import { CURRENT_VERSION } from '../update/index.js';

const SENTRY_DSN =
  'https://31639c0da4dc3a24f47eef0222a1122c@o4510985021358080.ingest.de.sentry.io/4511068579823696';

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
