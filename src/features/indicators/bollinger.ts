import type { Candle } from '@/domain/models/market/Candle';

import type { CandleValueSource } from '@/features/indicators/ma';
import { toSourceValues } from '@/features/indicators/ma';

export interface BollingerBandsSeries {
  middle: Array<number | null>;
  upper: Array<number | null>;
  lower: Array<number | null>;
}

export function computeBollingerBands(
  candles: Candle[],
  period: number,
  standardDeviationMultiplier = 2,
  source: CandleValueSource = 'close',
): BollingerBandsSeries {
  assertPeriod(period);

  if (!Number.isFinite(standardDeviationMultiplier) || standardDeviationMultiplier < 0) {
    throw new Error('Bollinger standard deviation multiplier must be non-negative.');
  }

  const values = toSourceValues(candles, source);
  const middle = new Array<number | null>(values.length).fill(null);
  const upper = new Array<number | null>(values.length).fill(null);
  const lower = new Array<number | null>(values.length).fill(null);

  for (let index = period - 1; index < values.length; index += 1) {
    const windowStart = index - period + 1;
    const window = values.slice(windowStart, index + 1);

    const mean = window.reduce((sum, value) => sum + value, 0) / period;
    const variance =
      window.reduce((sum, value) => {
        const diff = value - mean;
        return sum + diff * diff;
      }, 0) / period;

    const standardDeviation = Math.sqrt(variance);

    middle[index] = mean;
    upper[index] = mean + standardDeviation * standardDeviationMultiplier;
    lower[index] = mean - standardDeviation * standardDeviationMultiplier;
  }

  return { middle, upper, lower };
}

function assertPeriod(period: number): void {
  if (!Number.isInteger(period) || period <= 0) {
    throw new Error('Indicator period must be a positive integer.');
  }
}
