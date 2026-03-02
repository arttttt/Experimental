import { describe, expect, it } from 'vitest';

import { Candle } from '@/domain/models/market/Candle';
import { computeMacd } from '@/features/indicators/macd';

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

describe('computeMacd', () => {
  it('computes MACD, signal, and histogram in aligned arrays', () => {
    const candles = buildCandles([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const values = computeMacd(candles, {
      fastPeriod: 3,
      slowPeriod: 6,
      signalPeriod: 3,
    });

    expect(values.macd).toEqual([null, null, null, null, null, 1.5, 1.5, 1.5, 1.5, 1.5]);
    expect(values.signal).toEqual([null, null, null, null, null, null, null, 1.5, 1.5, 1.5]);
    expect(values.histogram).toEqual([null, null, null, null, null, null, null, 0, 0, 0]);
  });

  it('rejects invalid fast/slow ordering', () => {
    const candles = buildCandles([1, 2, 3, 4, 5, 6]);

    expect(() => computeMacd(candles, { fastPeriod: 6, slowPeriod: 6 })).toThrow(
      'MACD fast period must be less than slow period.',
    );
  });
});
