/**
 * Best-effort on-chain event parsing for AlphaLend lending operations.
 *
 * Returns undefined so callers fall back to intent amounts.
 * TODO: identify exact event types from AlphaLend Move contracts.
 */

import type { ActivityAction } from '../../../core/action-types.js';
import type { ISuiEvent } from '../types.js';
interface TypeName {
  name: string;
}

interface BaseEvent {
  __type: ActivityAction;
  cointype: TypeName;
  market_id: string;
  position_id: string;
  partner_id?: string;
}
interface DepositEvent extends BaseEvent {
  __type: 'lending:supply';
  deposit_amount: string;
  deposit_value: string;
  deposit_fee: string;
}

interface WithdrawEvent extends BaseEvent {
  __type: 'lending:withdraw';
  withdraw_amount: string;
  withdraw_value: string;
  withdraw_fee: string;
}

interface BorrowEvent extends BaseEvent {
  __type: 'lending:borrow';
  borrow_amount: string;
  borrow_value: string;
  borrow_fee: string;
}

interface RepayEvent extends BaseEvent {
  __type: 'lending:repay';
  repay_amount: string;
  repay_value: string;
}

interface CollectRewardsEvent extends BaseEvent {
  __type: 'lending:claim_rewards';
  reward_type: TypeName;
  position_id: string;
  market_id: string;
  reward_amount: string;
}

export type AlphaLendEvent =
  | DepositEvent
  | WithdrawEvent
  | BorrowEvent
  | RepayEvent
  | CollectRewardsEvent[];

const ALPHALEND_PACKAGE_ID = '0xd631cd66138909636fc3f73ed75820d0c5b76332d1644608ed1c85ea2b8219b4';
function eventFactory(name: string): string {
  const inner = `${ALPHALEND_PACKAGE_ID}::alpha_lending::${name}`;
  return `${ALPHALEND_PACKAGE_ID}::events::Event<${inner}>`;
}
const EVENT_MAP = {
  'lending:supply': eventFactory('DepositEvent'),
  'lending:withdraw': eventFactory('WithdrawEvent'),
  'lending:borrow': eventFactory('BorrowEvent'),
  'lending:repay': eventFactory('RepayEvent'),
  'lending:claim_rewards': eventFactory('CollectRewardsEvent'),
};

/**
 * Extract the actual amount from AlphaLend on-chain events.
 *
 * Returns undefined to fall back to intent amounts until the exact
 * AlphaLend Move event types are identified and mapped.
 */
export function parseAlphaLendEvent(
  events: ISuiEvent[],
  action: ActivityAction,
): AlphaLendEvent | undefined {
  if (
    action !== 'lending:supply' &&
    action !== 'lending:borrow' &&
    action !== 'lending:withdraw' &&
    action !== 'lending:repay' &&
    action !== 'lending:claim_rewards'
  ) {
    throw new Error(`Invalid AlphaLend Action: ${action}`);
  }
  if (action === 'lending:claim_rewards') {
    return events
      .filter((e) => e.type === EVENT_MAP[action])
      .map((e) => {
        const parsed = e.parsedJson as { event: Record<string, unknown> };
        return { ...parsed.event, __type: 'lending:claim_rewards' } as CollectRewardsEvent;
      });
  }
  const raw = events.find((e) => e.type === EVENT_MAP[action]);
  if (raw === undefined) return undefined;
  const parsed = raw.parsedJson as { event: Record<string, unknown> };
  return { ...parsed.event, __type: action } as AlphaLendEvent;
}
