/**
 * Parsers for Sui on-chain events emitted by DeFi protocols.
 *
 * Events are the source of truth for actual amounts — not the optimistic
 * preview values from quotes. Both simulated (dry-run) and executed
 * transactions emit the same event types.
 */

/** 7K Aggregator settle::Swap event type. */
const SETTLE_SWAP_EVENT_TYPE =
  '0x17c0b1f7a6ad73f51268f16b8c06c049eecc2f28a270cdd29c06e3d2dea23302::settle::Swap';

/** Parsed swap amounts from a 7K settle::Swap event. */
export interface SwapEventAmounts {
  readonly amountIn: string;
  readonly amountOut: string;
}

/** Shape of a Sui event with parsedJson. */
interface SuiEventLike {
  readonly type: string;
  readonly parsedJson: unknown;
}

/**
 * Extract amountIn and amountOut from the 7K settle::Swap event
 * in a list of Sui events.
 *
 * Returns undefined if no matching event is found or if the parsed
 * fields are missing — the caller should fall back to preview values.
 */
export function parseSwapEvent(events: readonly SuiEventLike[]): SwapEventAmounts | undefined {
  const event = events.find((e) => e.type === SETTLE_SWAP_EVENT_TYPE);
  if (event === undefined) return undefined;

  const json = event.parsedJson as Record<string, unknown> | null | undefined;
  if (json === null || json === undefined) return undefined;

  const amountIn = json['amount_in'];
  const amountOut = json['amount_out'];

  if (typeof amountIn !== 'string' || typeof amountOut !== 'string') return undefined;

  return { amountIn, amountOut };
}
