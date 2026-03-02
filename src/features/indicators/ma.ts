import type { Candle } from '@/domain/models/market/Candle';

export type CandleValueSource = 'open' | 'high' | 'low' | 'close' | 'volume';

export function computeSma(
  candles: Candle[],
  period: number,
  source: CandleValueSource = 'close',
): Array<number | null> {
  assertPeriod(period);

  const values = toSourceValues(candles, source);
  const result = new Array<number | null>(values.length).fill(null);
  let rollingSum = 0;

  for (let index = 0; index < values.length; index += 1) {
    rollingSum += values[index];

    if (index >= period) {
      rollingSum -= values[index - period];
    }

    if (index >= period - 1) {
      result[index] = rollingSum / period;
    }
  }

  return result;
}

export function computeEma(
  candles: Candle[],
  period: number,
  source: CandleValueSource = 'close',
): Array<number | null> {
  assertPeriod(period);

  const values = toSourceValues(candles, source);
  return computeEmaFromValues(values, period);
}

export function computeEmaFromValues(values: number[], period: number): Array<number | null> {
  assertPeriod(period);

  const result = new Array<number | null>(values.length).fill(null);
  if (values.length < period) {
    return result;
  }

  let seedSum = 0;
  for (let index = 0; index < period; index += 1) {
    seedSum += values[index];
  }

  const seedIndex = period - 1;
  let previousEma = seedSum / period;
  result[seedIndex] = previousEma;

  const multiplier = 2 / (period + 1);

  for (let index = seedIndex + 1; index < values.length; index += 1) {
    previousEma = (values[index] - previousEma) * multiplier + previousEma;
    result[index] = previousEma;
  }

  return result;
}

export function toSourceValues(candles: Candle[], source: CandleValueSource): number[] {
  return candles.map((candle) => candle[source]);
}

function assertPeriod(period: number): void {
  if (!Number.isInteger(period) || period <= 0) {
    throw new Error('Indicator period must be a positive integer.');
  }
}
