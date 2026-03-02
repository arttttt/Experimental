import { describe, expect, it } from 'vitest';

import { Candle } from '@/domain/models/market/Candle';
import { computeEma, computeSma } from '@/features/indicators/ma';

function buildCandles(closes: number[]): Candle[] {
  return closes.map(
    (close, index) =>
      new Candle({
        openTimeUnixSec: index + 1,
        open: close,
        high: close,
        low: close,
        close,
        volume: 100,
      }),
  );
}

describe('moving averages', () => {
  it('computes SMA values with leading nulls', () => {
    const candles = buildCandles([1, 2, 3, 4, 5]);

    expect(computeSma(candles, 3)).toEqual([null, null, 2, 3, 4]);
  });

  it('computes EMA values with SMA seed', () => {
    const candles = buildCandles([1, 2, 3, 4, 5]);

    expect(computeEma(candles, 3)).toEqual([null, null, 2, 3, 4]);
  });

  it('rejects invalid periods', () => {
    const candles = buildCandles([1, 2, 3]);

    expect(() => computeSma(candles, 0)).toThrow('Indicator period must be a positive integer.');
    expect(() => computeEma(candles, -1)).toThrow('Indicator period must be a positive integer.');
  });
});
