import { describe, it, expect } from 'vitest';
import {
  validateConfig,
  ConfigValidationError,
  DEFAULT_MAX_SINGLE_TRADE_CEILING,
  DEFAULT_MAX_24H_VOLUME_CEILING,
  DEFAULT_MAX_PERP_LEVERAGE_CEILING,
} from '../../config/schema.js';

function makeConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    chain: {
      sui: {
        rpc: 'https://fullnode.mainnet.sui.io:443',
        limits: {
          max_single_trade: 200,
          max_24h_volume: 500,
        },
        ...overrides,
      },
    },
  };
}

describe('Config upper bounds validation', () => {
  it('accepts limits within default ceiling', () => {
    const config = validateConfig(makeConfig());
    expect(config.chain['sui']?.limits?.max_single_trade).toBe(200);
  });

  it('rejects max_single_trade exceeding default ceiling', () => {
    const raw = makeConfig({
      limits: {
        max_single_trade: DEFAULT_MAX_SINGLE_TRADE_CEILING + 1,
        max_24h_volume: 500,
      },
    });

    expect(() => validateConfig(raw)).toThrow(ConfigValidationError);
    expect(() => validateConfig(raw)).toThrow(/exceeds the safety ceiling/);
  });

  it('rejects max_24h_volume exceeding default ceiling', () => {
    const raw = makeConfig({
      limits: {
        max_single_trade: 200,
        max_24h_volume: DEFAULT_MAX_24H_VOLUME_CEILING + 1,
      },
    });

    expect(() => validateConfig(raw)).toThrow(ConfigValidationError);
    expect(() => validateConfig(raw)).toThrow(/exceeds the safety ceiling/);
  });

  it('allows custom ceiling via security section', () => {
    const raw = {
      security: {
        max_single_trade_ceiling: 50_000,
      },
      chain: {
        sui: {
          rpc: 'https://fullnode.mainnet.sui.io:443',
          limits: {
            max_single_trade: 25_000,
            max_24h_volume: 500,
          },
        },
      },
    };

    const config = validateConfig(raw);
    expect(config.chain['sui']?.limits?.max_single_trade).toBe(25_000);
    expect(config.security?.max_single_trade_ceiling).toBe(50_000);
  });

  it('rejects value exceeding custom ceiling', () => {
    const raw = {
      security: {
        max_single_trade_ceiling: 5_000,
      },
      chain: {
        sui: {
          rpc: 'https://fullnode.mainnet.sui.io:443',
          limits: {
            max_single_trade: 6_000,
            max_24h_volume: 500,
          },
        },
      },
    };

    expect(() => validateConfig(raw)).toThrow(ConfigValidationError);
  });

  it('rejects invalid security config values', () => {
    const raw = {
      security: {
        max_single_trade_ceiling: -1,
      },
      chain: {
        sui: {
          rpc: 'https://fullnode.mainnet.sui.io:443',
        },
      },
    };

    expect(() => validateConfig(raw)).toThrow(ConfigValidationError);
  });
});

describe('PerpConfig validation', () => {
  it('rejects max_leverage < 1', () => {
    expect(() =>
      validateConfig(makeConfig({ perp: { allowlist_markets: ['SUI-PERP'], max_leverage: 0 } })),
    ).toThrow();
  });

  it('rejects max_leverage above ceiling', () => {
    expect(() =>
      validateConfig(
        makeConfig({
          perp: {
            allowlist_markets: ['SUI-PERP'],
            max_leverage: DEFAULT_MAX_PERP_LEVERAGE_CEILING + 1,
          },
        }),
      ),
    ).toThrow(/ceiling/);
  });

  it('accepts valid perp config', () => {
    const cfg = validateConfig(
      makeConfig({
        perp: {
          allowlist_markets: ['SUI-PERP'],
          max_leverage: 10,
          max_single_order: 500,
          max_24h_volume: 5000,
          max_24h_withdraw: 1000,
        },
      }),
    );
    expect(cfg.chain['sui']?.perp?.max_leverage).toBe(10);
  });

  it('accepts absent perp config', () => {
    const cfg = validateConfig(makeConfig({}));
    expect(cfg.chain['sui']?.perp).toBeUndefined();
  });

  it('rejects empty string in allowlist_markets', () => {
    expect(() => validateConfig(makeConfig({ perp: { allowlist_markets: [''] } }))).toThrow();
  });

  it('rejects duplicate entries in allowlist_markets', () => {
    expect(() =>
      validateConfig(makeConfig({ perp: { allowlist_markets: ['SUI-PERP', 'SUI-PERP'] } })),
    ).toThrow(/duplicate/i);
  });
});
