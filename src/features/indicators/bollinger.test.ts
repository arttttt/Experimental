import { describe, expect, it } from 'vitest';

import { Candle } from '@/domain/models/market/Candle';
import { computeBollingerBands } from '@/features/indicators/bollinger';

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

describe('computeBollingerBands', () => {
  it('computes middle, upper, and lower bands', () => {
    const candles = buildCandles([1, 2, 3, 4, 5]);
    const bands = computeBollingerBands(candles, 3);

    expect(bands.middle).toEqual([null, null, 2, 3, 4]);
    expect(bands.upper[2]).toBeCloseTo(3.632993, 6);
    expect(bands.lower[2]).toBeCloseTo(0.367007, 6);
    expect(bands.upper[4]).toBeCloseTo(5.632993, 6);
    expect(bands.lower[4]).toBeCloseTo(2.367007, 6);
  });
});
