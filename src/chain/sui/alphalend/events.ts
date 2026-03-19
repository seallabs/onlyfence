/**
 * Best-effort on-chain event parsing for AlphaLend lending operations.
 *
 * Returns undefined so callers fall back to intent amounts.
 * TODO: identify exact event types from AlphaLend Move contracts.
 */

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
