import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AlphalendClient } from '@alphafi/alphalend-sdk';

// Mock the alphalend-sdk
const mockGetAllMarkets = vi.fn();

vi.mock('@alphafi/alphalend-sdk', () => ({
  AlphalendClient: class MockAlphalendClient {
    getAllMarkets = mockGetAllMarkets;
  },
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let resolveMarketId: typeof import('../chain/sui/alphalend/markets.js').resolveMarketId;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../chain/sui/alphalend/markets.js');
  resolveMarketId = mod.resolveMarketId;
});

describe('resolveMarketId', () => {
  let mockClient: AlphalendClient;

  beforeEach(() => {
    mockClient = { getAllMarkets: mockGetAllMarkets } as unknown as AlphalendClient;
  });

  it('should return explicit marketId when provided (no API call)', async () => {
    const result = await resolveMarketId(mockClient, '0x2::sui::SUI', 'explicit-market-42');

    expect(result).toBe('explicit-market-42');
    expect(mockGetAllMarkets).not.toHaveBeenCalled();
  });

  it('should auto-resolve when exactly one market matches coinType', async () => {
    mockGetAllMarkets.mockResolvedValue([
      { marketId: 'market-1', coinType: '0x2::sui::SUI' },
      { marketId: 'market-2', coinType: '0xdba3::usdc::USDC' },
    ]);

    const result = await resolveMarketId(mockClient, '0x2::sui::SUI');

    expect(result).toBe('market-1');
    expect(mockGetAllMarkets).toHaveBeenCalledOnce();
  });

  it('should throw when multiple markets match coinType', async () => {
    mockGetAllMarkets.mockResolvedValue([
      { marketId: 'market-1', coinType: '0x2::sui::SUI' },
      { marketId: 'market-3', coinType: '0x2::sui::SUI' },
      { marketId: 'market-2', coinType: '0xdba3::usdc::USDC' },
    ]);

    await expect(resolveMarketId(mockClient, '0x2::sui::SUI')).rejects.toThrow(/multiple markets/i);
  });

  it('should throw when no markets match coinType', async () => {
    mockGetAllMarkets.mockResolvedValue([{ marketId: 'market-2', coinType: '0xdba3::usdc::USDC' }]);

    await expect(resolveMarketId(mockClient, '0x2::sui::SUI')).rejects.toThrow(/no market/i);
  });
});
