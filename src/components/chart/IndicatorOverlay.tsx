import { useEffect } from 'react';
import {
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type UTCTimestamp,
} from 'lightweight-charts';

import type { Candle } from '@/domain/models/market/Candle';
import {
  computeIndicators,
  type BollingerIndicatorConfig,
  type EmaIndicatorConfig,
  type SmaIndicatorConfig,
} from '@/features/indicators/engine';

interface OverlayRenderBase {
  id: string;
  label: string;
}

type ChartLineWidth = 1 | 2 | 3 | 4;

export interface MovingAverageOverlay extends OverlayRenderBase {
  kind: 'sma' | 'ema';
  period: number;
  color: string;
  lineWidth: ChartLineWidth;
}

export interface BollingerOverlay extends OverlayRenderBase {
  kind: 'bollinger';
  period: number;
  standardDeviationMultiplier?: number;
  middleColor: string;
  upperColor: string;
  lowerColor: string;
  lineWidth: ChartLineWidth;
}

export type OverlayRenderConfig = MovingAverageOverlay | BollingerOverlay;

interface IndicatorOverlayProps {
  chart: IChartApi | null;
  candles: Candle[];
  overlays: OverlayRenderConfig[];
}

export function IndicatorOverlay(props: IndicatorOverlayProps) {
  useEffect(() => {
    if (!props.chart || props.overlays.length === 0) {
      return;
    }

    const chart = props.chart;
    const series: Array<ISeriesApi<'Line'>> = [];
    const indicatorConfigs = props.overlays.map((overlay) => toIndicatorConfig(overlay));
    const overlayById = new Map(props.overlays.map((overlay) => [overlay.id, overlay]));
    const results = computeIndicators(props.candles, indicatorConfigs);

    results.forEach((result) => {
      const overlay = overlayById.get(result.id);
      if (!overlay) {
        return;
      }

      if ((result.kind === 'sma' || result.kind === 'ema') && overlay.kind !== 'bollinger') {
        const lineSeries = chart.addSeries(LineSeries, {
          title: overlay.label,
          color: overlay.color,
          lineWidth: overlay.lineWidth,
          priceLineVisible: false,
        });
        lineSeries.setData(toLineData(result.values, result.timestamps));
        series.push(lineSeries);
        return;
      }

      if (result.kind === 'bollinger' && overlay.kind === 'bollinger') {
        const middleSeries = chart.addSeries(LineSeries, {
          title: `${overlay.label} mid`,
          color: overlay.middleColor,
          lineWidth: overlay.lineWidth,
          priceLineVisible: false,
        });
        middleSeries.setData(toLineData(result.middle, result.timestamps));
        series.push(middleSeries);

        const upperSeries = chart.addSeries(LineSeries, {
          title: `${overlay.label} upper`,
          color: overlay.upperColor,
          lineWidth: overlay.lineWidth,
          priceLineVisible: false,
        });
        upperSeries.setData(toLineData(result.upper, result.timestamps));
        series.push(upperSeries);

        const lowerSeries = chart.addSeries(LineSeries, {
          title: `${overlay.label} lower`,
          color: overlay.lowerColor,
          lineWidth: overlay.lineWidth,
          priceLineVisible: false,
        });
        lowerSeries.setData(toLineData(result.lower, result.timestamps));
        series.push(lowerSeries);
      }
    });

    return () => {
      series.forEach((lineSeries) => {
        chart.removeSeries(lineSeries);
      });
    };
  }, [props.candles, props.chart, props.overlays]);

  return null;
}

function toIndicatorConfig(overlay: OverlayRenderConfig): SmaIndicatorConfig | EmaIndicatorConfig | BollingerIndicatorConfig {
  if (overlay.kind === 'sma') {
    return {
      kind: 'sma',
      id: overlay.id,
      period: overlay.period,
    };
  }

  if (overlay.kind === 'ema') {
    return {
      kind: 'ema',
      id: overlay.id,
      period: overlay.period,
    };
  }

  if (overlay.kind === 'bollinger') {
    return {
      kind: 'bollinger',
      id: overlay.id,
      period: overlay.period,
      standardDeviationMultiplier: overlay.standardDeviationMultiplier,
    };
  }

  throw new Error(`Unsupported overlay kind: ${JSON.stringify(overlay)}`);
}

function toLineData(values: Array<number | null>, timestamps: number[]): LineData[] {
  const data: LineData[] = [];

  values.forEach((value, index) => {
    if (value === null || timestamps[index] === undefined) {
      return;
    }

    data.push({
      time: timestamps[index] as UTCTimestamp,
      value,
    });
  });

  return data;
}
