import { describe, expect, it, vi } from 'vitest';

import type { Candle, CandleRequest } from '@/domain/models/market/Candle';
import { MarketDataClientError } from '@/data/sources/api/MarketDataClientError';
import type { OhlcvClient } from '@/data/sources/api/OhlcvClient';
import { OhlcvMarketDataService } from '@/features/market-data/OhlcvMarketDataService';

const REQUEST: CandleRequest = {
  address: 'pair-address',
  interval: '1m',
  fromUnixSec: 100,
  toUnixSec: 200,
};

function createCandle(time: number): Candle {
  return {
    openTimeUnixSec: time,
    open: 1,
    high: 2,
    low: 0.5,
    close: 1.5,
    volume: 42,
  };
}

describe('OhlcvMarketDataService', () => {
  it('uses primary source and caches successful result', async () => {
    const primaryClient: OhlcvClient = {
      getCandles: vi.fn().mockResolvedValue([createCandle(100)]),
    };
    const fallbackClient: OhlcvClient = {
      getCandles: vi.fn(),
    };

    const service = new OhlcvMarketDataService({
      primaryClient,
      fallbackClient,
    });

    const firstResult = await service.getCandles(REQUEST);
    const secondResult = await service.getCandles(REQUEST);

    expect(firstResult).toHaveLength(1);
    expect(secondResult).toHaveLength(1);
    expect(primaryClient.getCandles).toHaveBeenCalledTimes(1);
    expect(fallbackClient.getCandles).not.toHaveBeenCalled();
  });

  it('falls back when primary fails', async () => {
    const primaryClient: OhlcvClient = {
      getCandles: vi.fn().mockRejectedValue(new MarketDataClientError('birdeye', 'boom')),
    };
    const fallbackClient: OhlcvClient = {
      getCandles: vi.fn().mockResolvedValue([createCandle(100)]),
    };

    const service = new OhlcvMarketDataService({
      primaryClient,
      fallbackClient,
    });

    const result = await service.getCandles(REQUEST);

    expect(result).toHaveLength(1);
    expect(fallbackClient.getCandles).toHaveBeenCalledTimes(1);
  });

  it('throws combined error when primary and fallback fail', async () => {
    const primaryClient: OhlcvClient = {
      getCandles: vi.fn().mockRejectedValue(new MarketDataClientError('birdeye', 'primary')),
    };
    const fallbackClient: OhlcvClient = {
      getCandles: vi.fn().mockRejectedValue(new MarketDataClientError('dexscreener', 'fallback')),
    };

    const service = new OhlcvMarketDataService({
      primaryClient,
      fallbackClient,
    });

    await expect(service.getCandles(REQUEST)).rejects.toThrow(
      'Primary source failed (primary); fallback failed (fallback)',
    );
  });
});
