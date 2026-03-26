import { describe, expect, it } from 'vitest';
import type {
  ActionIntent,
  BorrowIntent,
  ClaimRewardsIntent,
  PerpCancelOrderIntent,
  PerpDepositIntent,
  PerpPlaceOrderIntent,
  PerpWithdrawIntent,
  RepayIntent,
  SwapIntent,
  WithdrawIntent,
} from '../core/action-types.js';
import { extractCoinTypes } from '../core/action-types.js';

describe('ActionIntent', () => {
  it('discriminates SwapIntent by action field', () => {
    const intent: ActionIntent = {
      action: 'trade:swap',
      chainId: 'sui:mainnet',
      walletAddress: '0x' + 'a'.repeat(64),
      params: {
        coinTypeIn: '0x2::sui::SUI',
        coinTypeOut: '0xdba3::usdc::USDC',
        amountIn: '1000000000',
        slippageBps: 100,
      },
    };

    expect(intent.action).toBe('trade:swap');
    if (intent.action === 'trade:swap') {
      expect(intent.params.coinTypeIn).toBe('0x2::sui::SUI');
      expect(intent.params.slippageBps).toBe(100);
    }
  });

  it('discriminates SupplyIntent by action field', () => {
    const intent: ActionIntent = {
      action: 'lending:supply',
      chainId: 'sui:mainnet',
      walletAddress: '0x' + 'a'.repeat(64),
      params: {
        coinType: '0x2::sui::SUI',
        amount: '1000000000',
        protocol: 'navi',
        marketId: 'market-1',
      },
    };

    expect(intent.action).toBe('lending:supply');
    if (intent.action === 'lending:supply') {
      expect(intent.params.protocol).toBe('navi');
      expect(intent.params.marketId).toBe('market-1');
    }
  });

  it('discriminates BorrowIntent by action field', () => {
    const intent: ActionIntent = {
      action: 'lending:borrow',
      chainId: 'sui:mainnet',
      walletAddress: '0x' + 'a'.repeat(64),
      params: {
        coinType: '0x2::sui::SUI',
        amount: '500000000',
        protocol: 'alphalend',
        marketId: 'market-2',
      },
      tradeValueUsd: 10.5,
    };

    expect(intent.action).toBe('lending:borrow');
    if (intent.action === 'lending:borrow') {
      expect(intent.params.coinType).toBe('0x2::sui::SUI');
      expect(intent.params.marketId).toBe('market-2');
      expect(intent.tradeValueUsd).toBe(10.5);
    }
  });

  it('discriminates WithdrawIntent by action field', () => {
    const intent: ActionIntent = {
      action: 'lending:withdraw',
      chainId: 'sui:mainnet',
      walletAddress: '0x' + 'a'.repeat(64),
      params: {
        coinType: '0x2::sui::SUI',
        amount: '0',
        protocol: 'alphalend',
        marketId: 'market-3',
        withdrawAll: true,
      },
    };

    expect(intent.action).toBe('lending:withdraw');
    if (intent.action === 'lending:withdraw') {
      expect(intent.params.withdrawAll).toBe(true);
    }
  });

  it('discriminates RepayIntent by action field', () => {
    const intent: ActionIntent = {
      action: 'lending:repay',
      chainId: 'sui:mainnet',
      walletAddress: '0x' + 'a'.repeat(64),
      params: {
        coinType: '0x2::sui::SUI',
        amount: '1000000000',
        protocol: 'alphalend',
        marketId: 'market-4',
      },
      tradeValueUsd: 5.0,
    };

    expect(intent.action).toBe('lending:repay');
    if (intent.action === 'lending:repay') {
      expect(intent.params.marketId).toBe('market-4');
    }
  });

  it('discriminates ClaimRewardsIntent by action field', () => {
    const intent: ActionIntent = {
      action: 'lending:claim_rewards',
      chainId: 'sui:mainnet',
      walletAddress: '0x' + 'a'.repeat(64),
      params: {
        protocol: 'alphalend',
      },
    };

    expect(intent.action).toBe('lending:claim_rewards');
    if (intent.action === 'lending:claim_rewards') {
      expect(intent.params.protocol).toBe('alphalend');
    }
  });

  it('discriminates PerpPlaceOrderIntent by action field', () => {
    const intent: ActionIntent = {
      action: 'perp:place_order',
      chainId: 'sui:mainnet',
      walletAddress: '0x' + 'a'.repeat(64),
      params: {
        marketSymbol: 'BTC-PERP',
        side: 'LONG',
        quantityE9: '1000000000',
        orderType: 'MARKET',
        leverageE9: '5000000000',
        collateralCoinType: '0xusdc::usdc::USDC',
        marketCoinType: '0xbf1b::bluefin_pro::BTC',
      },
      valueUsd: 50000,
    };

    expect(intent.action).toBe('perp:place_order');
    if (intent.action === 'perp:place_order') {
      expect(intent.params.marketSymbol).toBe('BTC-PERP');
      expect(intent.params.side).toBe('LONG');
      expect(intent.params.orderType).toBe('MARKET');
      expect(intent.params.collateralCoinType).toBe('0xusdc::usdc::USDC');
    }
  });

  it('discriminates PerpCancelOrderIntent by action field', () => {
    const intent: ActionIntent = {
      action: 'perp:cancel_order',
      chainId: 'sui:mainnet',
      walletAddress: '0x' + 'a'.repeat(64),
      params: {
        marketSymbol: 'ETH-PERP',
        orderHashes: ['0xhash1', '0xhash2'],
      },
    };

    expect(intent.action).toBe('perp:cancel_order');
    if (intent.action === 'perp:cancel_order') {
      expect(intent.params.marketSymbol).toBe('ETH-PERP');
      expect(intent.params.orderHashes).toEqual(['0xhash1', '0xhash2']);
    }
  });

  it('discriminates PerpDepositIntent by action field', () => {
    const intent: ActionIntent = {
      action: 'perp:deposit',
      chainId: 'sui:mainnet',
      walletAddress: '0x' + 'a'.repeat(64),
      params: {
        coinType: '0xusdc::usdc::USDC',
        amount: '10000000000',
      },
      valueUsd: 10000,
    };

    expect(intent.action).toBe('perp:deposit');
    if (intent.action === 'perp:deposit') {
      expect(intent.params.coinType).toBe('0xusdc::usdc::USDC');
      expect(intent.params.amount).toBe('10000000000');
    }
  });

  it('discriminates PerpWithdrawIntent by action field', () => {
    const intent: ActionIntent = {
      action: 'perp:withdraw',
      chainId: 'sui:mainnet',
      walletAddress: '0x' + 'a'.repeat(64),
      params: {
        assetSymbol: 'USDC',
        amountE9: '5000000000',
      },
      valueUsd: 5000,
    };

    expect(intent.action).toBe('perp:withdraw');
    if (intent.action === 'perp:withdraw') {
      expect(intent.params.assetSymbol).toBe('USDC');
      expect(intent.params.amountE9).toBe('5000000000');
    }
  });
});

describe('extractCoinTypes', () => {
  const base = {
    chainId: 'sui:mainnet' as const,
    walletAddress: '0x' + 'a'.repeat(64),
  };

  it('returns both coin types for trade:swap', () => {
    const intent: ActionIntent = {
      ...base,
      action: 'trade:swap',
      params: {
        coinTypeIn: '0x2::sui::SUI',
        coinTypeOut: '0xusdc::usdc::USDC',
        amountIn: '1000000000',
        slippageBps: 100,
      },
    };
    expect(extractCoinTypes(intent)).toEqual(['0x2::sui::SUI', '0xusdc::usdc::USDC']);
  });

  it('returns coinType for lending actions', () => {
    const intent: ActionIntent = {
      ...base,
      action: 'lending:supply',
      params: {
        coinType: '0x2::sui::SUI',
        amount: '1000000000',
        protocol: 'alphalend',
        marketId: '1',
      },
    };
    expect(extractCoinTypes(intent)).toEqual(['0x2::sui::SUI']);
  });

  it('returns empty array for lending:claim_rewards', () => {
    const intent: ActionIntent = {
      ...base,
      action: 'lending:claim_rewards',
      params: { protocol: 'alphalend' },
    };
    expect(extractCoinTypes(intent)).toEqual([]);
  });

  it('returns collateral and market coin types for perp:place_order', () => {
    const intent: ActionIntent = {
      ...base,
      action: 'perp:place_order',
      params: {
        marketSymbol: 'BTC-PERP',
        side: 'LONG',
        quantityE9: '1000000000',
        orderType: 'MARKET',
        leverageE9: '5000000000',
        collateralCoinType: '0xusdc::usdc::USDC',
        marketCoinType: '0xbf1b::bluefin_pro::BTC',
      },
    };
    expect(extractCoinTypes(intent)).toEqual(['0xusdc::usdc::USDC', '0xbf1b::bluefin_pro::BTC']);
  });

  it('returns empty array for perp:cancel_order', () => {
    const intent: ActionIntent = {
      ...base,
      action: 'perp:cancel_order',
      params: {
        marketSymbol: 'BTC-PERP',
        orderHashes: ['0xhash1'],
      },
    };
    expect(extractCoinTypes(intent)).toEqual([]);
  });

  it('returns coinType for perp:deposit', () => {
    const intent: ActionIntent = {
      ...base,
      action: 'perp:deposit',
      params: {
        coinType: '0xusdc::usdc::USDC',
        amount: '10000000000',
      },
    };
    expect(extractCoinTypes(intent)).toEqual(['0xusdc::usdc::USDC']);
  });

  it('returns empty for perp:withdraw (no coin type to cache)', () => {
    const intent: ActionIntent = {
      ...base,
      action: 'perp:withdraw',
      params: {
        assetSymbol: 'USDC',
        amountE9: '5000000000',
      },
    };
    expect(extractCoinTypes(intent)).toEqual([]);
  });
});
