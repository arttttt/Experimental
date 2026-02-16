import { describe, expect, it } from 'vitest';

import { CandleNormalizer } from '@/data/sources/api/CandleNormalizer';

describe('CandleNormalizer', () => {
  it('normalizes object candles and sorts by time', () => {
    const candles = CandleNormalizer.normalize([
      { unixTime: 200, o: '2', h: '3', l: '1', c: '2.5', v: '100' },
      { unixTime: 100, open: 1, high: 2, low: 0.5, close: 1.5, volume: 50 },
    ]);

    expect(candles).toHaveLength(2);
    expect(candles[0].openTimeUnixSec).toBe(100);
    expect(candles[1].openTimeUnixSec).toBe(200);
  });

  it('normalizes tuple candles and converts milliseconds to seconds', () => {
    const candles = CandleNormalizer.normalize([[1700000000000, '1', '2', '0.5', '1.5', '25']]);

    expect(candles).toHaveLength(1);
    expect(candles[0].openTimeUnixSec).toBe(1_700_000_000);
    expect(candles[0].close).toBe(1.5);
  });

  it('drops malformed values', () => {
    const candles = CandleNormalizer.normalize([
      { unixTime: 100, o: '1', h: '2', l: '0.5', c: '1.5', v: '10' },
      { unixTime: 200, o: 'bad', h: '2', l: '0.5', c: '1.5', v: '10' },
    ]);

    expect(candles).toHaveLength(1);
    expect(candles[0].openTimeUnixSec).toBe(100);
  });
});
