/**
 * Best-effort on-chain event parsing for AlphaLend lending operations.
 *
 * Returns undefined so callers fall back to intent amounts.
 * TODO: identify exact event types from AlphaLend Move contracts.
 */

import type { FinishContext } from '../../../core/action-builder.js';

export interface LendingEventAmounts {
  readonly amount: string;
}

/**
 * Extract the actual amount from AlphaLend on-chain events.
 *
 * Returns undefined to fall back to intent amounts until the exact
 * AlphaLend Move event types are identified and mapped.
 */
export function parseLendingEvent(
  _events: readonly { readonly type: string; readonly parsedJson: unknown }[],
  _action: string,
): LendingEventAmounts | undefined {
  return undefined;
}

/**
 * Extract the executed amount from a FinishContext's raw transaction response.
 *
 * Delegates to parseLendingEvent for the actual parsing. Returns undefined
 * if no raw response or events are present, causing callers to fall back
 * to intent amounts.
 */
export function parseAmountFromContext(context: FinishContext, action: string): string | undefined {
  if (context.rawResponse === undefined) return undefined;
  const raw = context.rawResponse as Record<string, unknown>;
  const events = raw['events'];
  if (!Array.isArray(events)) return undefined;
  return parseLendingEvent(events as { type: string; parsedJson: unknown }[], action)?.amount;
}
