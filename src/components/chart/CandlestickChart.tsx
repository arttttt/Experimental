import { useEffect, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type LineData,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { BirdeyeClient } from '@/data/sources/api/BirdeyeClient';
import { GeckoTerminalClient } from '@/data/sources/api/GeckoTerminalClient';
import type { CandleInterval } from '@/domain/models/market/Candle';
import { ChartToolbar, type ChartTokenOption } from '@/components/chart/ChartToolbar';
import { computeMacd } from '@/features/indicators/macd';
import { OhlcvMarketDataService } from '@/features/market-data/OhlcvMarketDataService';

interface CandlestickChartProps {
  poolAddress: string;
  tokenMint: string;
  selectedTokenSymbol: string;
  availableTokens: readonly ChartTokenOption[];
  onTokenChange: (symbol: string) => void;
}

const TIMEFRAME_SWITCH_DEBOUNCE_MS = 250;
const DEFAULT_CANDLE_LIMIT = 300;
const MACD_FAST_PERIOD = 12;
const MACD_SLOW_PERIOD = 26;
const MACD_SIGNAL_PERIOD = 9;
const geckoTerminalClient = new GeckoTerminalClient();
const birdeyeApiKey =
  typeof import.meta.env.VITE_BIRDEYE_API_KEY === 'string' &&
  import.meta.env.VITE_BIRDEYE_API_KEY.trim().length > 0
    ? import.meta.env.VITE_BIRDEYE_API_KEY.trim()
    : undefined;
const ohlcvMarketDataService = new OhlcvMarketDataService({
  primaryClient: geckoTerminalClient,
  fallbackClient: birdeyeApiKey ? new BirdeyeClient({ apiKey: birdeyeApiKey }) : undefined,
});

const timeframeToSeconds: Record<CandleInterval, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
};

export function CandlestickChart(props: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const macdRef = useRef<ISeriesApi<'Line'> | null>(null);
  const signalRef = useRef<ISeriesApi<'Line'> | null>(null);
  const macdHistogramRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const [selectedTimeframe, setSelectedTimeframe] = useState<CandleInterval>('15m');
  const [timeframe, setTimeframe] = useState<CandleInterval>(selectedTimeframe);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setTimeframe(selectedTimeframe);
    }, TIMEFRAME_SWITCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [selectedTimeframe]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: {
          type: ColorType.Solid,
          color: '#020617',
        },
        textColor: '#cbd5e1',
        panes: {
          enableResize: true,
          separatorColor: '#1e293b',
          separatorHoverColor: '#334155',
        },
      },
      grid: {
        vertLines: {
          color: '#1e293b',
        },
        horzLines: {
          color: '#1e293b',
        },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor: '#334155',
      },
      timeScale: {
        borderColor: '#334155',
        timeVisible: true,
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
      priceLineVisible: true,
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: '',
      color: '#475569',
      priceFormat: {
        type: 'volume',
      },
      lastValueVisible: false,
      priceLineVisible: false,
    });

    const macdSeries = chart.addSeries(
      LineSeries,
      {
        color: '#3b82f6',
        lineWidth: 2,
        title: 'MACD',
        crosshairMarkerVisible: true,
      },
      1,
    );

    const signalSeries = chart.addSeries(
      LineSeries,
      {
        color: '#f59e0b',
        lineWidth: 2,
        title: 'Signal',
        crosshairMarkerVisible: true,
      },
      1,
    );

    const macdHistogramSeries = chart.addSeries(
      HistogramSeries,
      {
        title: 'Histogram',
        lastValueVisible: false,
        priceLineVisible: false,
      },
      1,
    );

    chart.priceScale('').applyOptions({
      scaleMargins: {
        top: 0.8,
        bottom: 0,
      },
    });

    chartRef.current = chart;
    candlesRef.current = candleSeries;
    volumeRef.current = volumeSeries;
    macdRef.current = macdSeries;
    signalRef.current = signalSeries;
    macdHistogramRef.current = macdHistogramSeries;

    const chartWithPanes = chart as unknown as {
      panes?: () => Array<{ setHeight: (height: number) => void }>;
    };
    if (typeof chartWithPanes.panes === 'function') {
      const panes = chartWithPanes.panes();
      if (panes.length > 1) {
        panes[1].setHeight(150);
      }
    }

    const resizeObserver = new ResizeObserver(() => {
      chart.timeScale().fitContent();
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      candlesRef.current = null;
      volumeRef.current = null;
      macdRef.current = null;
      signalRef.current = null;
      macdHistogramRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (
      !candlesRef.current ||
      !volumeRef.current ||
      !macdRef.current ||
      !signalRef.current ||
      !macdHistogramRef.current ||
      !chartRef.current
    ) {
      return;
    }

    let isCancelled = false;

    const loadCandles = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const now = Math.floor(Date.now() / 1000);
        const intervalSeconds = timeframeToSeconds[timeframe];
        const fromUnixSec = now - intervalSeconds * DEFAULT_CANDLE_LIMIT;

        const candlePoints = await ohlcvMarketDataService.getCandles({
          address: props.poolAddress,
          fallbackAddress: props.tokenMint,
          interval: timeframe,
          fromUnixSec,
          toUnixSec: now,
          limit: DEFAULT_CANDLE_LIMIT,
        });

        if (isCancelled) {
          return;
        }

        const candles: CandlestickData[] = candlePoints.map((point) => ({
          time: point.openTimeUnixSec as UTCTimestamp,
          open: point.open,
          high: point.high,
          low: point.low,
          close: point.close,
        }));

        const volumes: HistogramData[] = candlePoints.map((point) => ({
          time: point.openTimeUnixSec as UTCTimestamp,
          value: point.volume,
          color: point.close >= point.open ? 'rgba(34, 197, 94, 0.35)' : 'rgba(239, 68, 68, 0.35)',
        }));

        const macdValues = computeMacd(candlePoints, {
          fastPeriod: MACD_FAST_PERIOD,
          slowPeriod: MACD_SLOW_PERIOD,
          signalPeriod: MACD_SIGNAL_PERIOD,
        });
        const macdLine: LineData[] = [];
        const signalLine: LineData[] = [];
        const macdHistogram: HistogramData[] = [];

        candlePoints.forEach((point, index) => {
          const time = point.openTimeUnixSec as UTCTimestamp;
          const macdValue = macdValues.macd[index];
          const signalValue = macdValues.signal[index];
          const histogramValue = macdValues.histogram[index];

          if (macdValue !== null) {
            macdLine.push({
              time,
              value: macdValue,
            });
          }

          if (signalValue !== null) {
            signalLine.push({
              time,
              value: signalValue,
            });
          }

          if (histogramValue !== null) {
            macdHistogram.push({
              time,
              value: histogramValue,
              color: histogramValue >= 0 ? 'rgba(34, 197, 94, 0.65)' : 'rgba(239, 68, 68, 0.65)',
            });
          }
        });

        candlesRef.current?.setData(candles);
        volumeRef.current?.setData(volumes);
        macdRef.current?.setData(macdLine);
        signalRef.current?.setData(signalLine);
        macdHistogramRef.current?.setData(macdHistogram);
        chartRef.current?.timeScale().fitContent();
      } catch (cause) {
        if (isCancelled) {
          return;
        }

        setError(cause instanceof Error ? cause.message : 'Failed to load candle data.');
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadCandles();

    return () => {
      isCancelled = true;
    };
  }, [props.poolAddress, props.tokenMint, timeframe]);

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-2xl shadow-slate-950/40">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Market</p>
          <h2 className="text-lg font-semibold text-slate-50">Candlestick Chart</h2>
        </div>
        {isLoading ? <span className="text-xs text-cyan-300">Loading...</span> : null}
      </div>

      <ChartToolbar
        selectedTimeframe={selectedTimeframe}
        onTimeframeChange={setSelectedTimeframe}
        selectedTokenSymbol={props.selectedTokenSymbol}
        tokenOptions={props.availableTokens}
        onTokenChange={props.onTokenChange}
      />

      <div className="mt-3 flex items-center justify-between gap-2 px-1">
        <p className="text-[0.68rem] uppercase tracking-[0.16em] text-slate-400">Indicators</p>
        <p className="text-xs text-slate-300">MACD ({MACD_FAST_PERIOD},{MACD_SLOW_PERIOD},{MACD_SIGNAL_PERIOD})</p>
      </div>

      <div ref={containerRef} className="mt-3 h-[420px] w-full overflow-hidden rounded-lg border border-slate-800" />

      {error ? (
        <p className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
      ) : null}
    </section>
  );
}
