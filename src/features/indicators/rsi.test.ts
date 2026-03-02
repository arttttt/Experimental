import { describe, expect, it } from 'vitest';

import { Candle } from '@/domain/models/market/Candle';
import { computeRsi } from '@/features/indicators/rsi';

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

describe('computeRsi', () => {
  it('computes RSI with default wilder smoothing', () => {
    const candles = buildCandles([1, 2, 3, 4, 5, 6, 7, 8]);
    const rsi = computeRsi(candles, 3);

    expect(rsi).toEqual([null, null, null, 100, 100, 100, 100, 100]);
  });

  it('returns 50 on flat price action after warmup period', () => {
    const candles = buildCandles([10, 10, 10, 10, 10]);
    const rsi = computeRsi(candles, 3);

    expect(rsi).toEqual([null, null, null, 50, 50]);
  });
});
