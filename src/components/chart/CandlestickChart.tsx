import { useEffect, useRef, useState } from 'react';
import {
  BaselineSeries,
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
  type LogicalRange,
  type UTCTimestamp,
} from 'lightweight-charts';
import { BirdeyeClient } from '@/data/sources/api/BirdeyeClient';
import { GeckoTerminalClient } from '@/data/sources/api/GeckoTerminalClient';
import { Candle } from '@/domain/models/market/Candle';
import type { CandleInterval } from '@/domain/models/market/Candle';
import { ChartToolbar, type ChartTokenOption } from '@/components/chart/ChartToolbar';
import { computeMacd } from '@/features/indicators/macd';
import { computeRsi } from '@/features/indicators/rsi';
import { OhlcvMarketDataService } from '@/features/market-data/OhlcvMarketDataService';

interface CandlestickChartProps {
  poolAddress: string;
  tokenMint: string;
  selectedTokenSymbol: string;
  availableTokens: readonly ChartTokenOption[];
  onTokenChange: (symbol: string) => void;
  rsiPeriod?: number;
}

const TIMEFRAME_SWITCH_DEBOUNCE_MS = 250;
const DEFAULT_CANDLE_LIMIT = 300;
const MACD_FAST_PERIOD = 12;
const MACD_SLOW_PERIOD = 26;
const MACD_SIGNAL_PERIOD = 9;
const DEFAULT_RSI_PERIOD = 14;
const CHART_STACK_HEIGHT_PX = 520;
const PANEL_HANDLE_HEIGHT_PX = 12;
const MIN_RSI_PANEL_HEIGHT_PX = 110;
const MAX_RSI_PANEL_HEIGHT_PX = 260;
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
  const mainContainerRef = useRef<HTMLDivElement | null>(null);
  const rsiContainerRef = useRef<HTMLDivElement | null>(null);
  const mainChartRef = useRef<IChartApi | null>(null);
  const rsiChartRef = useRef<IChartApi | null>(null);
  const candlesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const macdRef = useRef<ISeriesApi<'Line'> | null>(null);
  const signalRef = useRef<ISeriesApi<'Line'> | null>(null);
  const macdHistogramRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const rsiRef = useRef<ISeriesApi<'Line'> | null>(null);
  const rsiBelowRef = useRef<ISeriesApi<'Baseline'> | null>(null);
  const rsiAboveRef = useRef<ISeriesApi<'Baseline'> | null>(null);
  const closePriceByTimeRef = useRef<Map<UTCTimestamp, number>>(new Map());
  const rsiByTimeRef = useRef<Map<UTCTimestamp, number>>(new Map());
  const isSyncingTimeScaleRef = useRef(false);
  const isSyncingCrosshairRef = useRef(false);
  const [rsiPanelHeight, setRsiPanelHeight] = useState<number>(160);
  const [selectedTimeframe, setSelectedTimeframe] = useState<CandleInterval>('15m');
  const [timeframe, setTimeframe] = useState<CandleInterval>(selectedTimeframe);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const rsiPeriod = props.rsiPeriod ?? DEFAULT_RSI_PERIOD;
  const mainPanelHeight = CHART_STACK_HEIGHT_PX - rsiPanelHeight - PANEL_HANDLE_HEIGHT_PX;

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setTimeframe(selectedTimeframe);
    }, TIMEFRAME_SWITCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [selectedTimeframe]);

  useEffect(() => {
    if (!mainContainerRef.current || !rsiContainerRef.current) {
      return;
    }

    const mainChart = createChart(mainContainerRef.current, {
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

    const rsiChart = createChart(rsiContainerRef.current, {
      autoSize: true,
      layout: {
        background: {
          type: ColorType.Solid,
          color: '#020617',
        },
        textColor: '#cbd5e1',
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

    const candleSeries = mainChart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
      priceLineVisible: true,
    });

    const volumeSeries = mainChart.addSeries(HistogramSeries, {
      priceScaleId: '',
      color: '#475569',
      priceFormat: {
        type: 'volume',
      },
      lastValueVisible: false,
      priceLineVisible: false,
    });

    const macdSeries = mainChart.addSeries(
      LineSeries,
      {
        color: '#3b82f6',
        lineWidth: 2,
        title: 'MACD',
        crosshairMarkerVisible: true,
      },
      1,
    );

    const signalSeries = mainChart.addSeries(
      LineSeries,
      {
        color: '#f59e0b',
        lineWidth: 2,
        title: 'Signal',
        crosshairMarkerVisible: true,
      },
      1,
    );

    const macdHistogramSeries = mainChart.addSeries(
      HistogramSeries,
      {
        title: 'Histogram',
        lastValueVisible: false,
        priceLineVisible: false,
      },
      1,
    );

    mainChart.priceScale('').applyOptions({
      scaleMargins: {
        top: 0.8,
        bottom: 0,
      },
    });

    const rsiBelowSeries = rsiChart.addSeries(BaselineSeries, {
      baseValue: {
        type: 'price',
        price: 30,
      },
      topFillColor1: 'rgba(0, 0, 0, 0)',
      topFillColor2: 'rgba(0, 0, 0, 0)',
      bottomFillColor1: 'rgba(34, 197, 94, 0.28)',
      bottomFillColor2: 'rgba(34, 197, 94, 0.08)',
      topLineColor: 'rgba(0, 0, 0, 0)',
      bottomLineColor: 'rgba(22, 163, 74, 0.2)',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const rsiAboveSeries = rsiChart.addSeries(BaselineSeries, {
      baseValue: {
        type: 'price',
        price: 70,
      },
      topFillColor1: 'rgba(239, 68, 68, 0.3)',
      topFillColor2: 'rgba(239, 68, 68, 0.1)',
      bottomFillColor1: 'rgba(0, 0, 0, 0)',
      bottomFillColor2: 'rgba(0, 0, 0, 0)',
      topLineColor: 'rgba(220, 38, 38, 0.2)',
      bottomLineColor: 'rgba(0, 0, 0, 0)',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const rsiSeries = rsiChart.addSeries(LineSeries, {
      color: '#38bdf8',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      autoscaleInfoProvider: () => ({
        priceRange: {
          minValue: 0,
          maxValue: 100,
        },
      }),
    });

    rsiSeries.createPriceLine({
      price: 30,
      color: '#16a34a',
      lineStyle: 2,
      lineWidth: 1,
      axisLabelVisible: true,
      title: '30',
    });

    rsiSeries.createPriceLine({
      price: 70,
      color: '#dc2626',
      lineStyle: 2,
      lineWidth: 1,
      axisLabelVisible: true,
      title: '70',
    });

    mainChartRef.current = mainChart;
    rsiChartRef.current = rsiChart;
    candlesRef.current = candleSeries;
    volumeRef.current = volumeSeries;
    macdRef.current = macdSeries;
    signalRef.current = signalSeries;
    macdHistogramRef.current = macdHistogramSeries;
    rsiRef.current = rsiSeries;
    rsiBelowRef.current = rsiBelowSeries;
    rsiAboveRef.current = rsiAboveSeries;

    const chartWithPanes = mainChart as unknown as {
      panes?: () => Array<{ setHeight: (height: number) => void }>;
    };
    if (typeof chartWithPanes.panes === 'function') {
      const panes = chartWithPanes.panes();
      if (panes.length > 1) {
        panes[1].setHeight(150);
      }
    }

    const syncMainToRsiRange = (range: LogicalRange | null) => {
      if (!range || isSyncingTimeScaleRef.current) {
        return;
      }

      isSyncingTimeScaleRef.current = true;
      rsiChart.timeScale().setVisibleLogicalRange(range);
      isSyncingTimeScaleRef.current = false;
    };

    const syncRsiToMainRange = (range: LogicalRange | null) => {
      if (!range || isSyncingTimeScaleRef.current) {
        return;
      }

      isSyncingTimeScaleRef.current = true;
      mainChart.timeScale().setVisibleLogicalRange(range);
      isSyncingTimeScaleRef.current = false;
    };

    const syncMainToRsiCrosshair: Parameters<IChartApi['subscribeCrosshairMove']>[0] = (param) => {
      if (isSyncingCrosshairRef.current) {
        return;
      }

      isSyncingCrosshairRef.current = true;

      if (param.time !== undefined) {
        const rsiPrice = rsiByTimeRef.current.get(param.time as UTCTimestamp);
        if (typeof rsiPrice === 'number') {
          rsiChart.setCrosshairPosition(rsiPrice, param.time, rsiSeries);
        } else {
          rsiChart.clearCrosshairPosition();
        }
      } else {
        rsiChart.clearCrosshairPosition();
      }

      isSyncingCrosshairRef.current = false;
    };

    const syncRsiToMainCrosshair: Parameters<IChartApi['subscribeCrosshairMove']>[0] = (param) => {
      if (isSyncingCrosshairRef.current) {
        return;
      }

      isSyncingCrosshairRef.current = true;

      if (param.time !== undefined) {
        const closePrice = closePriceByTimeRef.current.get(param.time as UTCTimestamp);
        if (typeof closePrice === 'number') {
          mainChart.setCrosshairPosition(closePrice, param.time, candleSeries);
        } else {
          mainChart.clearCrosshairPosition();
        }
      } else {
        mainChart.clearCrosshairPosition();
      }

      isSyncingCrosshairRef.current = false;
    };

    mainChart.timeScale().subscribeVisibleLogicalRangeChange(syncMainToRsiRange);
    rsiChart.timeScale().subscribeVisibleLogicalRangeChange(syncRsiToMainRange);
    mainChart.subscribeCrosshairMove(syncMainToRsiCrosshair);
    rsiChart.subscribeCrosshairMove(syncRsiToMainCrosshair);

    const resizeObserver = new ResizeObserver(() => {
      mainChart.timeScale().fitContent();
      rsiChart.timeScale().fitContent();
    });

    resizeObserver.observe(mainContainerRef.current);
    resizeObserver.observe(rsiContainerRef.current);

    return () => {
      resizeObserver.disconnect();

      mainChart.timeScale().unsubscribeVisibleLogicalRangeChange(syncMainToRsiRange);
      rsiChart.timeScale().unsubscribeVisibleLogicalRangeChange(syncRsiToMainRange);
      mainChart.unsubscribeCrosshairMove(syncMainToRsiCrosshair);
      rsiChart.unsubscribeCrosshairMove(syncRsiToMainCrosshair);

      mainChart.remove();
      rsiChart.remove();

      mainChartRef.current = null;
      rsiChartRef.current = null;
      candlesRef.current = null;
      volumeRef.current = null;
      macdRef.current = null;
      signalRef.current = null;
      macdHistogramRef.current = null;
      rsiRef.current = null;
      rsiBelowRef.current = null;
      rsiAboveRef.current = null;
      closePriceByTimeRef.current = new Map();
      rsiByTimeRef.current = new Map();
    };
  }, []);

  useEffect(() => {
    const mainChart = mainChartRef.current;
    const rsiChart = rsiChartRef.current;

    if (!mainChart || !rsiChart) {
      return;
    }

    mainChart.applyOptions({
      height: mainPanelHeight,
    });
    rsiChart.applyOptions({
      height: rsiPanelHeight,
    });
  }, [mainPanelHeight, rsiPanelHeight]);

  useEffect(() => {
    if (
      !candlesRef.current ||
      !volumeRef.current ||
      !mainChartRef.current ||
      !rsiRef.current ||
      !rsiBelowRef.current ||
      !rsiAboveRef.current ||
      !rsiChartRef.current ||
      !macdRef.current ||
      !signalRef.current ||
      !macdHistogramRef.current
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

        const candleModels = candlePoints.map(
          (point) =>
            new Candle({
              openTimeUnixSec: point.openTimeUnixSec,
              open: point.open,
              high: point.high,
              low: point.low,
              close: point.close,
              volume: point.volume,
            }),
        );

        const rsiValues = computeRsi(candleModels, rsiPeriod);
        const rsiData: LineData[] = [];
        closePriceByTimeRef.current = new Map();
        rsiByTimeRef.current = new Map();

        candlePoints.forEach((point, index) => {
          const time = point.openTimeUnixSec as UTCTimestamp;
          closePriceByTimeRef.current.set(time, point.close);

          const rsiValue = rsiValues[index];
          if (typeof rsiValue === 'number') {
            rsiData.push({
              time,
              value: rsiValue,
            });
            rsiByTimeRef.current.set(time, rsiValue);
          }
        });

        candlesRef.current?.setData(candles);
        volumeRef.current?.setData(volumes);
        macdRef.current?.setData(macdLine);
        signalRef.current?.setData(signalLine);
        macdHistogramRef.current?.setData(macdHistogram);
        rsiRef.current?.setData(rsiData);
        rsiBelowRef.current?.setData(rsiData);
        rsiAboveRef.current?.setData(rsiData);
        mainChartRef.current?.timeScale().fitContent();
        rsiChartRef.current?.timeScale().fitContent();
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
  }, [props.poolAddress, props.tokenMint, rsiPeriod, timeframe]);

  const handleStartResize = () => {
    const handlePointerMove = (event: PointerEvent) => {
      if ((event.buttons & 1) === 0) {
        return;
      }

      setRsiPanelHeight((previousHeight) => {
        const nextHeight = previousHeight - event.movementY;
        return Math.max(MIN_RSI_PANEL_HEIGHT_PX, Math.min(MAX_RSI_PANEL_HEIGHT_PX, nextHeight));
      });
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });
  };

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
        <p className="text-xs text-slate-300">MACD ({MACD_FAST_PERIOD},{MACD_SLOW_PERIOD},{MACD_SIGNAL_PERIOD}) + RSI ({rsiPeriod})</p>
      </div>

      <div className="mt-3 overflow-hidden rounded-lg border border-slate-800 bg-slate-950/80">
        <div
          ref={mainContainerRef}
          className="w-full"
          style={{
            height: `${mainPanelHeight}px`,
          }}
        />

        <div
          onPointerDown={handleStartResize}
          className="group relative h-3 w-full cursor-row-resize bg-slate-900/95"
          role="separator"
          aria-label="Resize RSI panel"
          aria-orientation="horizontal"
        >
          <span className="absolute inset-x-1/2 top-1/2 h-0.5 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-600 transition-colors group-hover:bg-cyan-400" />
        </div>

        <div
          ref={rsiContainerRef}
          className="w-full"
          style={{
            height: `${rsiPanelHeight}px`,
          }}
        />
      </div>

      {error ? (
        <p className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
      ) : null}
    </section>
  );
}
