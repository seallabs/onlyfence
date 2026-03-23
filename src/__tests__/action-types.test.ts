import { describe, expect, it } from 'vitest';
import type {
  ActionIntent,
  BorrowIntent,
  ClaimRewardsIntent,
  RepayIntent,
  SwapIntent,
  WithdrawIntent,
} from '../core/action-types.js';

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
});
