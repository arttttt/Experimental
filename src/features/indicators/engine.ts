import type { Candle } from '@/domain/models/market/Candle';

import { computeBollingerBands } from '@/features/indicators/bollinger';
import { computeMacd } from '@/features/indicators/macd';
import type { CandleValueSource } from '@/features/indicators/ma';
import { computeEma, computeSma } from '@/features/indicators/ma';
import { computeRsi } from '@/features/indicators/rsi';

interface IndicatorConfigBase {
  id?: string;
}

interface SourceConfig {
  source?: CandleValueSource;
}

export interface SmaIndicatorConfig extends IndicatorConfigBase, SourceConfig {
  kind: 'sma';
  period: number;
}

export interface EmaIndicatorConfig extends IndicatorConfigBase, SourceConfig {
  kind: 'ema';
  period: number;
}

export interface BollingerIndicatorConfig extends IndicatorConfigBase, SourceConfig {
  kind: 'bollinger';
  period: number;
  standardDeviationMultiplier?: number;
}

export interface RsiIndicatorConfig extends IndicatorConfigBase, SourceConfig {
  kind: 'rsi';
  period?: number;
}

export interface MacdIndicatorConfig extends IndicatorConfigBase, SourceConfig {
  kind: 'macd';
  fastPeriod?: number;
  slowPeriod?: number;
  signalPeriod?: number;
}

export type IndicatorConfig =
  | SmaIndicatorConfig
  | EmaIndicatorConfig
  | BollingerIndicatorConfig
  | RsiIndicatorConfig
  | MacdIndicatorConfig;

interface IndicatorResultBase {
  id: string;
  timestamps: number[];
}

export interface SingleValueIndicatorResult extends IndicatorResultBase {
  kind: 'sma' | 'ema' | 'rsi';
  values: Array<number | null>;
}

export interface BollingerIndicatorResult extends IndicatorResultBase {
  kind: 'bollinger';
  middle: Array<number | null>;
  upper: Array<number | null>;
  lower: Array<number | null>;
}

export interface MacdIndicatorResult extends IndicatorResultBase {
  kind: 'macd';
  macd: Array<number | null>;
  signal: Array<number | null>;
  histogram: Array<number | null>;
}

export type IndicatorResult =
  | SingleValueIndicatorResult
  | BollingerIndicatorResult
  | MacdIndicatorResult;

export function computeIndicators(candles: Candle[], configs: IndicatorConfig[]): IndicatorResult[] {
  const timestamps = candles.map((candle) => candle.openTimeUnixSec);

  return configs.map((config, index) => {
    const id = config.id ?? `${config.kind}-${index + 1}`;

    switch (config.kind) {
      case 'sma': {
        const values = computeSma(candles, config.period, config.source);
        return {
          kind: 'sma',
          id,
          timestamps,
          values,
        };
      }
      case 'ema': {
        const values = computeEma(candles, config.period, config.source);
        return {
          kind: 'ema',
          id,
          timestamps,
          values,
        };
      }
      case 'bollinger': {
        const bands = computeBollingerBands(
          candles,
          config.period,
          config.standardDeviationMultiplier,
          config.source,
        );

        return {
          kind: 'bollinger',
          id,
          timestamps,
          middle: bands.middle,
          upper: bands.upper,
          lower: bands.lower,
        };
      }
      case 'rsi': {
        const values = computeRsi(candles, config.period, config.source);
        return {
          kind: 'rsi',
          id,
          timestamps,
          values,
        };
      }
      case 'macd': {
        const values = computeMacd(candles, {
          fastPeriod: config.fastPeriod,
          slowPeriod: config.slowPeriod,
          signalPeriod: config.signalPeriod,
          source: config.source,
        });

        return {
          kind: 'macd',
          id,
          timestamps,
          macd: values.macd,
          signal: values.signal,
          histogram: values.histogram,
        };
      }
      default: {
        const neverReached: never = config;
        throw new Error(`Unsupported indicator config: ${JSON.stringify(neverReached)}`);
      }
    }
  });
}
