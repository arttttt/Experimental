import type { Candle } from '@/domain/models/market/Candle';

import type { CandleValueSource } from '@/features/indicators/ma';
import { computeEmaFromValues, toSourceValues } from '@/features/indicators/ma';

export interface MacdSeries {
  macd: Array<number | null>;
  signal: Array<number | null>;
  histogram: Array<number | null>;
}

export function computeMacd(
  candles: Candle[],
  params: {
    fastPeriod?: number;
    slowPeriod?: number;
    signalPeriod?: number;
    source?: CandleValueSource;
  } = {},
): MacdSeries {
  const fastPeriod = params.fastPeriod ?? 12;
  const slowPeriod = params.slowPeriod ?? 26;
  const signalPeriod = params.signalPeriod ?? 9;
  const source = params.source ?? 'close';

  assertPeriod(fastPeriod, 'MACD fast period');
  assertPeriod(slowPeriod, 'MACD slow period');
  assertPeriod(signalPeriod, 'MACD signal period');

  if (fastPeriod >= slowPeriod) {
    throw new Error('MACD fast period must be less than slow period.');
  }

  const values = toSourceValues(candles, source);
  const fastEma = computeEmaFromValues(values, fastPeriod);
  const slowEma = computeEmaFromValues(values, slowPeriod);

  const macd = new Array<number | null>(values.length).fill(null);
  const macdValues: number[] = [];

  for (let index = 0; index < values.length; index += 1) {
    const fastValue = fastEma[index];
    const slowValue = slowEma[index];

    if (fastValue === null || slowValue === null) {
      continue;
    }

    const macdValue = fastValue - slowValue;
    macd[index] = macdValue;
    macdValues.push(macdValue);
  }

  const signal = new Array<number | null>(values.length).fill(null);
  const histogram = new Array<number | null>(values.length).fill(null);
  if (macdValues.length < signalPeriod) {
    return { macd, signal, histogram };
  }

  const signalByMacdIndex = computeEmaFromValues(macdValues, signalPeriod);

  let macdIndex = 0;
  for (let index = 0; index < values.length; index += 1) {
    const macdValue = macd[index];
    if (macdValue === null) {
      continue;
    }

    const signalValue = signalByMacdIndex[macdIndex];
    macdIndex += 1;

    if (signalValue === null) {
      continue;
    }

    signal[index] = signalValue;
    histogram[index] = macdValue - signalValue;
  }

  return { macd, signal, histogram };
}

function assertPeriod(period: number, label: string): void {
  if (!Number.isInteger(period) || period <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
}
