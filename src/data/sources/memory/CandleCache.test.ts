import { describe, expect, it, vi } from 'vitest';

import { Candle } from '@/domain/models/market/Candle';
import { CandleCache } from '@/data/sources/memory/CandleCache';

describe('CandleCache', () => {
  it('returns cached candles for equal request key', () => {
    const cache = new CandleCache({ ttlMs: 5_000 });
    const request = {
      address: 'pair-address',
      interval: '1m' as const,
      fromUnixSec: 100,
      toUnixSec: 200,
    };
    const candles = [
      new Candle({
        openTimeUnixSec: 100,
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
        volume: 10,
      }),
    ];

    cache.set(request, candles);

    const cached = cache.get(request);
    expect(cached).not.toBeNull();
    expect(cached).toEqual(candles);
  });

  it('invalidates expired cache entries', () => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_000);

    const cache = new CandleCache({ ttlMs: 10 });
    const request = {
      address: 'pair-address',
      interval: '1m' as const,
      fromUnixSec: 100,
      toUnixSec: 200,
    };

    cache.set(request, []);

    nowSpy.mockReturnValue(1_100);
    expect(cache.get(request)).toBeNull();

    nowSpy.mockRestore();
  });
});
