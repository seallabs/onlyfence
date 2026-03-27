import BigNumber from 'bignumber.js';
import type { Logger } from 'pino';
import type { ChainId } from '../../../core/action-types.js';
import type { ActivityLog } from '../../../db/activity-log.js';
import type { CoinMetadataRepository } from '../../../db/coin-metadata-repo.js';
import type { BluefinClient } from './client.js';
import { toErrorMessage } from '../../../utils/index.js';
import {
  BLUEFIN_DECIMALS,
  parseBluefinMarketSymbol,
  toBluefinCoinType,
  type BluefinSide,
} from './types.js';

/**
 * Sync filled trades from the Bluefin API into the activities table.
 *
 * Uses the last sync timestamp to fetch only new trades. Each fill
 * becomes a `perp:filled` activity row with synthetic coin types.
 */
export async function syncFills(
  client: BluefinClient,
  activityLog: ActivityLog,
  coinMetadataRepo: CoinMetadataRepository,
  chainId: ChainId,
  walletAddress: string,
  logger: Logger,
): Promise<{ synced: number }> {
  const lastSync = activityLog.getLastSyncTimestamp('perp:filled', 'bluefin_pro');

  const startTimeAtMillis = lastSync !== null ? new Date(lastSync).getTime() + 1 : undefined;

  const tradesParams =
    startTimeAtMillis !== undefined ? { startTimeAtMillis, limit: 1000 } : { limit: 1000 };
  const trades = await client.getTrades(tradesParams);

  // Single pass: collect unique symbols for metadata upsert, then log each trade.
  // We resolve symbol -> coinType once per unique symbol, caching in seenSymbols.
  const seenSymbols = new Map<string, string | null>(); // symbol -> coinType or null (unparseable)

  function resolveMarketCoinType(symbol: string): string | null {
    const cached = seenSymbols.get(symbol);
    if (cached !== undefined) return cached;
    try {
      const baseAsset = parseBluefinMarketSymbol(symbol);
      const coinType = toBluefinCoinType(baseAsset);
      seenSymbols.set(symbol, coinType);
      coinMetadataRepo.upsertBulk([
        {
          coin_type: coinType,
          chain_id: chainId,
          symbol: baseAsset,
          name: `Bluefin Pro ${symbol}`,
          decimals: BLUEFIN_DECIMALS,
        },
      ]);
      return coinType;
    } catch (err: unknown) {
      logger.warn(
        { symbol, error: toErrorMessage(err) },
        'Skipping unparseable symbol in syncFills',
      );
      seenSymbols.set(symbol, null);
      return null;
    }
  }

  let synced = 0;

  for (const trade of trades) {
    const symbol = trade.symbol ?? '';
    if (symbol === '') continue;

    const marketCoinType = resolveMarketCoinType(symbol);
    if (marketCoinType === null) continue;

    const notionalUsd = new BigNumber(trade.priceE9).times(trade.quantityE9).div(1e18).toNumber();

    activityLog.logActivity({
      chain_id: chainId,
      wallet_address: walletAddress,
      action: 'perp:filled',
      protocol: 'bluefin_pro',
      policy_decision: 'approved',
      token_a_type: marketCoinType,
      token_a_amount: trade.quantityE9,
      value_usd: notionalUsd,
      metadata: {
        marketSymbol: symbol,
        side: mapTradeSide(trade.side),
        fillPrice: trade.priceE9,
        fillQuantity: trade.quantityE9,
        leverage: '0',
        fee: trade.tradingFeeE9 ?? '0',
        orderHash: trade.orderHash ?? '',
        tradeId: trade.id,
        isClose: false,
      },
    });

    synced++;
  }

  return { synced };
}

function mapTradeSide(side: string): BluefinSide {
  if (side === 'LONG' || side === 'BUY') return 'LONG';
  if (side === 'SHORT' || side === 'SELL') return 'SHORT';
  throw new Error(`Unknown trade side "${side}": expected LONG, BUY, SHORT, or SELL`);
}
