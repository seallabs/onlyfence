import { describe, it, expect } from 'vitest';
import type { ActionIntent, SwapIntent } from '../core/action-types.js';

describe('ActionIntent', () => {
  it('discriminates SwapIntent by action field', () => {
    const intent: ActionIntent = {
      action: 'swap',
      chainId: 'sui:mainnet',
      walletAddress: '0x' + 'a'.repeat(64),
      params: {
        coinTypeIn: '0x2::sui::SUI',
        coinTypeOut: '0xdba3::usdc::USDC',
        amountIn: '1000000000',
        slippageBps: 100,
      },
    };

    expect(intent.action).toBe('swap');
    if (intent.action === 'swap') {
      expect(intent.params.coinTypeIn).toBe('0x2::sui::SUI');
      expect(intent.params.slippageBps).toBe(100);
    }
  });

  it('discriminates SupplyIntent by action field', () => {
    const intent: ActionIntent = {
      action: 'supply',
      chainId: 'sui:mainnet',
      walletAddress: '0x' + 'a'.repeat(64),
      params: {
        coinType: '0x2::sui::SUI',
        amount: '1000000000',
        protocol: 'navi',
      },
    };

    expect(intent.action).toBe('supply');
    if (intent.action === 'supply') {
      expect(intent.params.protocol).toBe('navi');
    }
  });
});
