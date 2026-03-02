import type { Candle } from '@/domain/models/market/Candle';

import type { CandleValueSource } from '@/features/indicators/ma';
import { toSourceValues } from '@/features/indicators/ma';

export function computeRsi(
  candles: Candle[],
  period = 14,
  source: CandleValueSource = 'close',
): Array<number | null> {
  assertPeriod(period);

  const values = toSourceValues(candles, source);
  const result = new Array<number | null>(values.length).fill(null);

  if (values.length <= period) {
    return result;
  }

  let gains = 0;
  let losses = 0;

  for (let index = 1; index <= period; index += 1) {
    const delta = values[index] - values[index - 1];
    if (delta >= 0) {
      gains += delta;
    } else {
      losses += Math.abs(delta);
    }
  }

  let averageGain = gains / period;
  let averageLoss = losses / period;
  result[period] = toRsiValue(averageGain, averageLoss);

  for (let index = period + 1; index < values.length; index += 1) {
    const delta = values[index] - values[index - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? Math.abs(delta) : 0;

    averageGain = (averageGain * (period - 1) + gain) / period;
    averageLoss = (averageLoss * (period - 1) + loss) / period;
    result[index] = toRsiValue(averageGain, averageLoss);
  }

  return result;
}

function toRsiValue(averageGain: number, averageLoss: number): number {
  if (averageGain === 0 && averageLoss === 0) {
    return 50;
  }

  if (averageLoss === 0) {
    return 100;
  }

  const relativeStrength = averageGain / averageLoss;
  return 100 - 100 / (1 + relativeStrength);
}

function assertPeriod(period: number): void {
  if (!Number.isInteger(period) || period <= 0) {
    throw new Error('Indicator period must be a positive integer.');
  }
}
