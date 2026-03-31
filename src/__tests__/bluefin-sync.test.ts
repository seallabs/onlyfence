import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import type { BluefinClient } from '../chain/sui/bluefin-pro/client.js';
import { syncFills } from '../chain/sui/bluefin-pro/sync.js';
import { toBluefinCoinType } from '../chain/sui/bluefin-pro/types.js';
import type { ActivityLog } from '../db/activity-log.js';
import type { CoinMetadataRepository } from '../db/coin-metadata-repo.js';

function makeMockTrade(overrides?: Record<string, unknown>) {
  return {
    id: 'trade-1',
    symbol: 'BTC-PERP',
    side: 'BUY',
    priceE9: '50000000000000',
    quantityE9: '1000000000',
    tradingFeeE9: '500000',
    orderHash: '0xorder1',
    ...overrides,
  };
}

function createMockLogger(): Logger {
  const logger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => logger),
    level: 'info',
  } as unknown as Logger;
  return logger;
}

describe('syncFills', () => {
  let mockClient: BluefinClient;
  let mockActivityLog: ActivityLog;
  let mockCoinMetadataRepo: CoinMetadataRepository;
  let mockLogger: Logger;

  beforeEach(() => {
    mockClient = {
      getTrades: vi.fn().mockResolvedValue([]),
    } as unknown as BluefinClient;
    mockActivityLog = {
      getLastSyncTimestamp: vi.fn().mockReturnValue(null),
      logActivity: vi.fn().mockReturnValue(1),
    } as unknown as ActivityLog;
    mockCoinMetadataRepo = {
      upsert: vi.fn(),
      upsertBulk: vi.fn(),
    } as unknown as CoinMetadataRepository;
    mockLogger = createMockLogger();
  });

  it('returns zero synced when no trades', async () => {
    const result = await syncFills(
      mockClient,
      mockActivityLog,
      mockCoinMetadataRepo,
      'sui:mainnet',
      '0xwallet',
      mockLogger,
    );
    expect(result.synced).toBe(0);
  });

  it('fetches trades with limit 1000 on first sync', async () => {
    await syncFills(
      mockClient,
      mockActivityLog,
      mockCoinMetadataRepo,
      'sui:mainnet',
      '0xwallet',
      mockLogger,
    );

    expect(mockClient.getTrades).toHaveBeenCalledWith({ limit: 1000 });
  });

  it('fetches trades since last sync timestamp', async () => {
    (mockActivityLog.getLastSyncTimestamp as ReturnType<typeof vi.fn>).mockReturnValue(
      '2026-03-20T12:00:00.000Z',
    );

    await syncFills(
      mockClient,
      mockActivityLog,
      mockCoinMetadataRepo,
      'sui:mainnet',
      '0xwallet',
      mockLogger,
    );

    expect(mockClient.getTrades).toHaveBeenCalledWith(
      expect.objectContaining({
        startTimeAtMillis: new Date('2026-03-20T12:00:00.000Z').getTime() + 1,
        limit: 1000,
      }),
    );
  });

  it('inserts trades as perp:filled activity rows', async () => {
    (mockClient.getTrades as ReturnType<typeof vi.fn>).mockResolvedValue([makeMockTrade()]);

    const result = await syncFills(
      mockClient,
      mockActivityLog,
      mockCoinMetadataRepo,
      'sui:mainnet',
      '0xwallet',
      mockLogger,
    );

    expect(result.synced).toBe(1);
    expect(mockActivityLog.logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        chain_id: 'sui:mainnet',
        wallet_address: '0xwallet',
        action: 'perp:filled',
        protocol: 'bluefin_pro',
        policy_decision: 'approved',
        token_a_type: toBluefinCoinType('BTC'),
        token_a_amount: '1000000000',
      }),
    );
  });

  it('computes notional USD from price * quantity / 1e18', async () => {
    (mockClient.getTrades as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeMockTrade({
        priceE9: '50000000000000',
        quantityE9: '1000000000',
      }),
    ]);

    await syncFills(
      mockClient,
      mockActivityLog,
      mockCoinMetadataRepo,
      'sui:mainnet',
      '0xwallet',
      mockLogger,
    );

    const call = (mockActivityLog.logActivity as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    // 50000000000000 * 1000000000 / 1e18 = 50000
    expect(call.value_usd).toBe(50000);
  });

  it('batch-upserts unique synthetic coin metadata', async () => {
    (mockClient.getTrades as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeMockTrade({ symbol: 'ETH-PERP' }),
    ]);

    await syncFills(
      mockClient,
      mockActivityLog,
      mockCoinMetadataRepo,
      'sui:mainnet',
      '0xwallet',
      mockLogger,
    );

    expect(mockCoinMetadataRepo.upsertBulk).toHaveBeenCalledWith([
      expect.objectContaining({
        coin_type: toBluefinCoinType('ETH'),
        chain_id: 'sui:mainnet',
        symbol: 'ETH',
        name: 'Bluefin Pro ETH-PERP',
        decimals: 9,
      }),
    ]);
  });

  it('maps BUY side to LONG', async () => {
    (mockClient.getTrades as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeMockTrade({ side: 'BUY' }),
    ]);

    await syncFills(
      mockClient,
      mockActivityLog,
      mockCoinMetadataRepo,
      'sui:mainnet',
      '0xwallet',
      mockLogger,
    );

    const call = (mockActivityLog.logActivity as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.metadata.side).toBe('LONG');
  });

  it('maps SELL side to SHORT', async () => {
    (mockClient.getTrades as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeMockTrade({ side: 'SELL' }),
    ]);

    await syncFills(
      mockClient,
      mockActivityLog,
      mockCoinMetadataRepo,
      'sui:mainnet',
      '0xwallet',
      mockLogger,
    );

    const call = (mockActivityLog.logActivity as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.metadata.side).toBe('SHORT');
  });

  it('syncs multiple trades and returns correct count', async () => {
    (mockClient.getTrades as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeMockTrade({ id: 't1' }),
      makeMockTrade({ id: 't2', symbol: 'ETH-PERP' }),
      makeMockTrade({ id: 't3' }),
    ]);

    const result = await syncFills(
      mockClient,
      mockActivityLog,
      mockCoinMetadataRepo,
      'sui:mainnet',
      '0xwallet',
      mockLogger,
    );

    expect(result.synced).toBe(3);
    expect(mockActivityLog.logActivity).toHaveBeenCalledTimes(3);
  });

  it('skips trades with empty symbol', async () => {
    (mockClient.getTrades as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeMockTrade({ symbol: '' }),
    ]);

    const result = await syncFills(
      mockClient,
      mockActivityLog,
      mockCoinMetadataRepo,
      'sui:mainnet',
      '0xwallet',
      mockLogger,
    );

    expect(result.synced).toBe(0);
    expect(mockActivityLog.logActivity).not.toHaveBeenCalled();
  });

  it('includes metadata with fill details', async () => {
    (mockClient.getTrades as ReturnType<typeof vi.fn>).mockResolvedValue([makeMockTrade()]);

    await syncFills(
      mockClient,
      mockActivityLog,
      mockCoinMetadataRepo,
      'sui:mainnet',
      '0xwallet',
      mockLogger,
    );

    const call = (mockActivityLog.logActivity as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.metadata).toEqual(
      expect.objectContaining({
        marketSymbol: 'BTC-PERP',
        fillPrice: '50000000000000',
        fillQuantity: '1000000000',
        fee: '500000',
        orderHash: '0xorder1',
        tradeId: 'trade-1',
      }),
    );
  });
});
