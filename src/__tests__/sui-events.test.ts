import { describe, it, expect } from 'vitest';
import { parseSwapEvent } from '../chain/sui/7k/events.js';

const SETTLE_SWAP_TYPE =
  '0x17c0b1f7a6ad73f51268f16b8c06c049eecc2f28a270cdd29c06e3d2dea23302::settle::Swap';

describe('parseSwapEvent', () => {
  it('extracts amountIn and amountOut from settle::Swap event', () => {
    const events = [
      {
        type: SETTLE_SWAP_TYPE,
        parsedJson: { amount_in: '100000000', amount_out: '98120000' },
      },
    ];

    const result = parseSwapEvent(events);

    expect(result).toEqual({ amountIn: '100000000', amountOut: '98120000' });
  });

  it('returns undefined when no matching event exists', () => {
    const events = [
      {
        type: '0xother::module::Event',
        parsedJson: { amount_in: '100', amount_out: '99' },
      },
    ];

    expect(parseSwapEvent(events)).toBeUndefined();
  });

  it('returns undefined for empty events array', () => {
    expect(parseSwapEvent([])).toBeUndefined();
  });

  it('returns undefined when parsedJson is null', () => {
    const events = [{ type: SETTLE_SWAP_TYPE, parsedJson: null }];

    expect(parseSwapEvent(events)).toBeUndefined();
  });

  it('returns undefined when parsedJson fields are missing', () => {
    const events = [
      {
        type: SETTLE_SWAP_TYPE,
        parsedJson: { some_other_field: 'value' },
      },
    ];

    expect(parseSwapEvent(events)).toBeUndefined();
  });

  it('returns undefined when amounts are not strings', () => {
    const events = [
      {
        type: SETTLE_SWAP_TYPE,
        parsedJson: { amount_in: 100, amount_out: 98 },
      },
    ];

    expect(parseSwapEvent(events)).toBeUndefined();
  });

  it('picks first matching event when multiple exist', () => {
    const events = [
      {
        type: SETTLE_SWAP_TYPE,
        parsedJson: { amount_in: '100', amount_out: '98' },
      },
      {
        type: SETTLE_SWAP_TYPE,
        parsedJson: { amount_in: '200', amount_out: '196' },
      },
    ];

    const result = parseSwapEvent(events);
    expect(result).toEqual({ amountIn: '100', amountOut: '98' });
  });
});
