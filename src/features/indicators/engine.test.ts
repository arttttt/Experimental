import { describe, expect, it } from 'vitest';

import { Candle } from '@/domain/models/market/Candle';
import { computeIndicators } from '@/features/indicators/engine';

function buildCandles(closes: number[]): Candle[] {
  return closes.map(
    (close, index) =>
      new Candle({
        openTimeUnixSec: 1_700_000_000 + index,
        open: close,
        high: close,
        low: close,
        close,
        volume: 100,
      }),
  );
}

describe('computeIndicators', () => {
  it('returns typed, timestamp-aligned indicator outputs', () => {
    const candles = buildCandles([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const results = computeIndicators(candles, [
      { kind: 'sma', period: 3, id: 'sma-3' },
      { kind: 'rsi', period: 3, id: 'rsi-3' },
      { kind: 'bollinger', period: 3, id: 'bb-3' },
      { kind: 'macd', fastPeriod: 3, slowPeriod: 6, signalPeriod: 3, id: 'macd' },
    ]);

    expect(results).toHaveLength(4);

    const sma = results[0];
    expect(sma.kind).toBe('sma');
    if (sma.kind === 'sma') {
      expect(sma.id).toBe('sma-3');
      expect(sma.values).toEqual([null, null, 2, 3, 4, 5, 6, 7, 8, 9]);
      expect(sma.timestamps).toEqual(candles.map((candle) => candle.openTimeUnixSec));
    }

    const macd = results[3];
    expect(macd.kind).toBe('macd');
    if (macd.kind === 'macd') {
      expect(macd.histogram[9]).toBe(0);
    }
  });

  it('supports empty candle arrays while preserving typed shape', () => {
    const results = computeIndicators([], [{ kind: 'sma', period: 3, id: 'sma-empty' }]);

    expect(results).toEqual([
      {
        kind: 'sma',
        id: 'sma-empty',
        timestamps: [],
        values: [],
      },
    ]);
  });
});
