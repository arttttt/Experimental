import { useEffect, useMemo, useRef, useState } from 'react';
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
import {
  ChartToolbar,
  type ChartIndicatorOption,
  type ChartIndicatorPatch,
  type ChartTokenOption,
} from '@/components/chart/ChartToolbar';
import {
  IndicatorOverlay,
  type OverlayRenderConfig,
} from '@/components/chart/IndicatorOverlay';
import { computeMacd } from '@/features/indicators/macd';
import { computeRsi } from '@/features/indicators/rsi';
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
const CHART_STACK_HEIGHT_PX = 520;
const PANEL_HANDLE_HEIGHT_PX = 12;
const MIN_RSI_PANEL_HEIGHT_PX = 110;
const MAX_RSI_PANEL_HEIGHT_PX = 260;
const INDICATOR_STORAGE_KEY = 'terminal.candlestick.indicators.v1';
type ChartLineWidth = 1 | 2 | 3 | 4;

interface SmaIndicatorSettings {
  kind: 'sma';
  enabled: boolean;
  period: number;
  color: string;
  lineWidth: ChartLineWidth;
}

interface EmaIndicatorSettings {
  kind: 'ema';
  enabled: boolean;
  period: number;
  color: string;
  lineWidth: ChartLineWidth;
}

interface BollingerIndicatorSettings {
  kind: 'bollinger';
  enabled: boolean;
  period: number;
  standardDeviationMultiplier: number;
  color: string;
  lineWidth: ChartLineWidth;
}

interface RsiIndicatorSettings {
  kind: 'rsi';
  enabled: boolean;
  period: number;
  color: string;
  lineWidth: ChartLineWidth;
}

interface MacdIndicatorSettings {
  kind: 'macd';
  enabled: boolean;
  fastPeriod: number;
  slowPeriod: number;
  signalPeriod: number;
  color: string;
  lineWidth: ChartLineWidth;
}

interface IndicatorSettingsState {
  sma: SmaIndicatorSettings;
  ema: EmaIndicatorSettings;
  bollinger: BollingerIndicatorSettings;
  rsi: RsiIndicatorSettings;
  macd: MacdIndicatorSettings;
}

const DEFAULT_INDICATOR_SETTINGS: IndicatorSettingsState = {
  sma: {
    kind: 'sma',
    enabled: true,
    period: 20,
    color: '#38bdf8',
    lineWidth: 2,
  },
  ema: {
    kind: 'ema',
    enabled: true,
    period: 21,
    color: '#f59e0b',
    lineWidth: 2,
  },
  bollinger: {
    kind: 'bollinger',
    enabled: true,
    period: 20,
    standardDeviationMultiplier: 2,
    color: '#a78bfa',
    lineWidth: 2,
  },
  rsi: {
    kind: 'rsi',
    enabled: true,
    period: 14,
    color: '#38bdf8',
    lineWidth: 2,
  },
  macd: {
    kind: 'macd',
    enabled: true,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    color: '#3b82f6',
    lineWidth: 2,
  },
};
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

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, Math.round(value)));
}

function clampDecimal(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, value));
}

function clampLineWidth(value: number): ChartLineWidth {
  const clampedValue = clampInteger(value, 1, 4);
  if (clampedValue === 1 || clampedValue === 2 || clampedValue === 3 || clampedValue === 4) {
    return clampedValue;
  }

  return 2;
}

function withAlpha(hexColor: string, alpha: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hexColor)) {
    return `rgba(59, 130, 246, ${alpha})`;
  }

  const red = Number.parseInt(hexColor.slice(1, 3), 16);
  const green = Number.parseInt(hexColor.slice(3, 5), 16);
  const blue = Number.parseInt(hexColor.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function sanitizeIndicatorSettings(settings: IndicatorSettingsState): IndicatorSettingsState {
  const fastPeriod = clampInteger(settings.macd.fastPeriod, 1, 200);
  const slowPeriodBase = clampInteger(settings.macd.slowPeriod, 2, 300);
  const slowPeriod = Math.max(slowPeriodBase, fastPeriod + 1);

  return {
    sma: {
      ...settings.sma,
      period: clampInteger(settings.sma.period, 1, 400),
      lineWidth: clampLineWidth(settings.sma.lineWidth),
    },
    ema: {
      ...settings.ema,
      period: clampInteger(settings.ema.period, 1, 400),
      lineWidth: clampLineWidth(settings.ema.lineWidth),
    },
    bollinger: {
      ...settings.bollinger,
      period: clampInteger(settings.bollinger.period, 1, 400),
      standardDeviationMultiplier: clampDecimal(settings.bollinger.standardDeviationMultiplier, 0, 6),
      lineWidth: clampLineWidth(settings.bollinger.lineWidth),
    },
    rsi: {
      ...settings.rsi,
      period: clampInteger(settings.rsi.period, 1, 400),
      lineWidth: clampLineWidth(settings.rsi.lineWidth),
    },
    macd: {
      ...settings.macd,
      fastPeriod,
      slowPeriod,
      signalPeriod: clampInteger(settings.macd.signalPeriod, 1, 200),
      lineWidth: clampLineWidth(settings.macd.lineWidth),
    },
  };
}

function loadIndicatorSettings(): IndicatorSettingsState {
  if (typeof window === 'undefined') {
    return DEFAULT_INDICATOR_SETTINGS;
  }

  try {
    const storedValue = window.localStorage.getItem(INDICATOR_STORAGE_KEY);
    if (!storedValue) {
      return DEFAULT_INDICATOR_SETTINGS;
    }

    const parsedValue = JSON.parse(storedValue) as Partial<IndicatorSettingsState>;
    return sanitizeIndicatorSettings({
      sma: { ...DEFAULT_INDICATOR_SETTINGS.sma, ...parsedValue.sma },
      ema: { ...DEFAULT_INDICATOR_SETTINGS.ema, ...parsedValue.ema },
      bollinger: { ...DEFAULT_INDICATOR_SETTINGS.bollinger, ...parsedValue.bollinger },
      rsi: { ...DEFAULT_INDICATOR_SETTINGS.rsi, ...parsedValue.rsi },
      macd: { ...DEFAULT_INDICATOR_SETTINGS.macd, ...parsedValue.macd },
    });
  } catch {
    return DEFAULT_INDICATOR_SETTINGS;
  }
}

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
  const [mainChartApi, setMainChartApi] = useState<IChartApi | null>(null);
  const [indicatorCandles, setIndicatorCandles] = useState<Candle[]>([]);
  const [indicatorSettings, setIndicatorSettings] = useState<IndicatorSettingsState>(() => loadIndicatorSettings());
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const mainPanelHeight = CHART_STACK_HEIGHT_PX - rsiPanelHeight - PANEL_HANDLE_HEIGHT_PX;
  const activeOverlayConfigs = useMemo<OverlayRenderConfig[]>(() => {
    const overlays: OverlayRenderConfig[] = [];

    if (indicatorSettings.sma.enabled) {
      overlays.push({
        id: 'sma',
        label: 'SMA',
        kind: 'sma',
        period: indicatorSettings.sma.period,
        color: indicatorSettings.sma.color,
        lineWidth: indicatorSettings.sma.lineWidth,
      });
    }

    if (indicatorSettings.ema.enabled) {
      overlays.push({
        id: 'ema',
        label: 'EMA',
        kind: 'ema',
        period: indicatorSettings.ema.period,
        color: indicatorSettings.ema.color,
        lineWidth: indicatorSettings.ema.lineWidth,
      });
    }

    if (indicatorSettings.bollinger.enabled) {
      overlays.push({
        id: 'bollinger',
        label: 'Bollinger',
        kind: 'bollinger',
        period: indicatorSettings.bollinger.period,
        standardDeviationMultiplier: indicatorSettings.bollinger.standardDeviationMultiplier,
        middleColor: withAlpha(indicatorSettings.bollinger.color, 0.75),
        upperColor: indicatorSettings.bollinger.color,
        lowerColor: indicatorSettings.bollinger.color,
        lineWidth: indicatorSettings.bollinger.lineWidth,
      });
    }

    return overlays;
  }, [indicatorSettings]);
  const indicatorToolbarOptions = useMemo<ChartIndicatorOption[]>(
    () => [
      {
        id: 'sma',
        kind: 'sma',
        label: 'SMA',
        pillLabel: `SMA ${indicatorSettings.sma.period}`,
        color: indicatorSettings.sma.color,
        lineWidth: indicatorSettings.sma.lineWidth,
        active: indicatorSettings.sma.enabled,
        period: indicatorSettings.sma.period,
      },
      {
        id: 'ema',
        kind: 'ema',
        label: 'EMA',
        pillLabel: `EMA ${indicatorSettings.ema.period}`,
        color: indicatorSettings.ema.color,
        lineWidth: indicatorSettings.ema.lineWidth,
        active: indicatorSettings.ema.enabled,
        period: indicatorSettings.ema.period,
      },
      {
        id: 'bollinger',
        kind: 'bollinger',
        label: 'Bollinger Bands',
        pillLabel: `BB ${indicatorSettings.bollinger.period}`,
        color: indicatorSettings.bollinger.color,
        lineWidth: indicatorSettings.bollinger.lineWidth,
        active: indicatorSettings.bollinger.enabled,
        period: indicatorSettings.bollinger.period,
        standardDeviationMultiplier: indicatorSettings.bollinger.standardDeviationMultiplier,
      },
      {
        id: 'rsi',
        kind: 'rsi',
        label: 'RSI',
        pillLabel: `RSI ${indicatorSettings.rsi.period}`,
        color: indicatorSettings.rsi.color,
        lineWidth: indicatorSettings.rsi.lineWidth,
        active: indicatorSettings.rsi.enabled,
        period: indicatorSettings.rsi.period,
      },
      {
        id: 'macd',
        kind: 'macd',
        label: 'MACD',
        pillLabel: `MACD ${indicatorSettings.macd.fastPeriod}/${indicatorSettings.macd.slowPeriod}/${indicatorSettings.macd.signalPeriod}`,
        color: indicatorSettings.macd.color,
        lineWidth: indicatorSettings.macd.lineWidth,
        active: indicatorSettings.macd.enabled,
        fastPeriod: indicatorSettings.macd.fastPeriod,
        slowPeriod: indicatorSettings.macd.slowPeriod,
        signalPeriod: indicatorSettings.macd.signalPeriod,
      },
    ],
    [indicatorSettings],
  );

  const handleIndicatorToggle = (indicatorId: string) => {
    setIndicatorSettings((previousSettings) => {
      switch (indicatorId) {
        case 'sma':
          return { ...previousSettings, sma: { ...previousSettings.sma, enabled: !previousSettings.sma.enabled } };
        case 'ema':
          return { ...previousSettings, ema: { ...previousSettings.ema, enabled: !previousSettings.ema.enabled } };
        case 'bollinger':
          return {
            ...previousSettings,
            bollinger: { ...previousSettings.bollinger, enabled: !previousSettings.bollinger.enabled },
          };
        case 'rsi':
          return { ...previousSettings, rsi: { ...previousSettings.rsi, enabled: !previousSettings.rsi.enabled } };
        case 'macd':
          return { ...previousSettings, macd: { ...previousSettings.macd, enabled: !previousSettings.macd.enabled } };
        default:
          return previousSettings;
      }
    });
  };

  const handleIndicatorPatch = (indicatorId: string, patch: ChartIndicatorPatch) => {
    setIndicatorSettings((previousSettings) => {
      switch (indicatorId) {
        case 'sma':
          return sanitizeIndicatorSettings({
            ...previousSettings,
            sma: {
              ...previousSettings.sma,
              color: patch.color ?? previousSettings.sma.color,
              lineWidth: patch.lineWidth !== undefined ? clampLineWidth(patch.lineWidth) : previousSettings.sma.lineWidth,
              period: patch.period ?? previousSettings.sma.period,
            },
          });
        case 'ema':
          return sanitizeIndicatorSettings({
            ...previousSettings,
            ema: {
              ...previousSettings.ema,
              color: patch.color ?? previousSettings.ema.color,
              lineWidth: patch.lineWidth !== undefined ? clampLineWidth(patch.lineWidth) : previousSettings.ema.lineWidth,
              period: patch.period ?? previousSettings.ema.period,
            },
          });
        case 'bollinger':
          return sanitizeIndicatorSettings({
            ...previousSettings,
            bollinger: {
              ...previousSettings.bollinger,
              color: patch.color ?? previousSettings.bollinger.color,
              lineWidth:
                patch.lineWidth !== undefined
                  ? clampLineWidth(patch.lineWidth)
                  : previousSettings.bollinger.lineWidth,
              period: patch.period ?? previousSettings.bollinger.period,
              standardDeviationMultiplier:
                patch.standardDeviationMultiplier ?? previousSettings.bollinger.standardDeviationMultiplier,
            },
          });
        case 'rsi':
          return sanitizeIndicatorSettings({
            ...previousSettings,
            rsi: {
              ...previousSettings.rsi,
              color: patch.color ?? previousSettings.rsi.color,
              lineWidth: patch.lineWidth !== undefined ? clampLineWidth(patch.lineWidth) : previousSettings.rsi.lineWidth,
              period: patch.period ?? previousSettings.rsi.period,
            },
          });
        case 'macd':
          return sanitizeIndicatorSettings({
            ...previousSettings,
            macd: {
              ...previousSettings.macd,
              color: patch.color ?? previousSettings.macd.color,
              lineWidth:
                patch.lineWidth !== undefined ? clampLineWidth(patch.lineWidth) : previousSettings.macd.lineWidth,
              fastPeriod: patch.fastPeriod ?? previousSettings.macd.fastPeriod,
              slowPeriod: patch.slowPeriod ?? previousSettings.macd.slowPeriod,
              signalPeriod: patch.signalPeriod ?? previousSettings.macd.signalPeriod,
            },
          });
        default:
          return previousSettings;
      }
    });
  };

  const handleIndicatorRemove = (indicatorId: string) => {
    setIndicatorSettings((previousSettings) => {
      switch (indicatorId) {
        case 'sma':
          return { ...previousSettings, sma: { ...previousSettings.sma, enabled: false } };
        case 'ema':
          return { ...previousSettings, ema: { ...previousSettings.ema, enabled: false } };
        case 'bollinger':
          return { ...previousSettings, bollinger: { ...previousSettings.bollinger, enabled: false } };
        case 'rsi':
          return { ...previousSettings, rsi: { ...previousSettings.rsi, enabled: false } };
        case 'macd':
          return { ...previousSettings, macd: { ...previousSettings.macd, enabled: false } };
        default:
          return previousSettings;
      }
    });
  };

  const handleResetIndicators = () => {
    setIndicatorSettings(DEFAULT_INDICATOR_SETTINGS);
  };

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setTimeframe(selectedTimeframe);
    }, TIMEFRAME_SWITCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [selectedTimeframe]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(INDICATOR_STORAGE_KEY, JSON.stringify(indicatorSettings));
  }, [indicatorSettings]);

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
    setMainChartApi(mainChart);
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
      setMainChartApi(null);
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
      setIndicatorCandles([]);
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
    macdRef.current?.applyOptions({
      color: indicatorSettings.macd.color,
      lineWidth: indicatorSettings.macd.lineWidth,
    });
    signalRef.current?.applyOptions({
      color: withAlpha(indicatorSettings.macd.color, 0.68),
      lineWidth: indicatorSettings.macd.lineWidth,
    });
    rsiRef.current?.applyOptions({
      color: indicatorSettings.rsi.color,
      lineWidth: indicatorSettings.rsi.lineWidth,
    });
  }, [indicatorSettings.macd.color, indicatorSettings.macd.lineWidth, indicatorSettings.rsi.color, indicatorSettings.rsi.lineWidth]);

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

        const macdLine: LineData[] = [];
        const signalLine: LineData[] = [];
        const macdHistogram: HistogramData[] = [];

        if (indicatorSettings.macd.enabled) {
          const macdValues = computeMacd(candlePoints, {
            fastPeriod: indicatorSettings.macd.fastPeriod,
            slowPeriod: indicatorSettings.macd.slowPeriod,
            signalPeriod: indicatorSettings.macd.signalPeriod,
          });

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
                color:
                  histogramValue >= 0
                    ? withAlpha(indicatorSettings.macd.color, 0.55)
                    : withAlpha('#ef4444', 0.65),
              });
            }
          });
        }

        const rsiValues = indicatorSettings.rsi.enabled
          ? computeRsi(candleModels, indicatorSettings.rsi.period)
          : candleModels.map(() => null);
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
        setIndicatorCandles(candleModels);
        mainChartRef.current?.timeScale().fitContent();
        rsiChartRef.current?.timeScale().fitContent();
      } catch (cause) {
        if (isCancelled) {
          return;
        }

        setIndicatorCandles([]);
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
  }, [
    indicatorSettings.macd.color,
    indicatorSettings.macd.enabled,
    indicatorSettings.macd.fastPeriod,
    indicatorSettings.macd.signalPeriod,
    indicatorSettings.macd.slowPeriod,
    indicatorSettings.rsi.enabled,
    indicatorSettings.rsi.period,
    props.poolAddress,
    props.tokenMint,
    timeframe,
  ]);

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
        indicators={indicatorToolbarOptions}
        onIndicatorToggle={handleIndicatorToggle}
        onIndicatorPatch={handleIndicatorPatch}
        onIndicatorRemove={handleIndicatorRemove}
        onResetIndicators={handleResetIndicators}
      />

      <div className="mt-3 flex items-center justify-between gap-2 px-1">
        <p className="text-[0.68rem] uppercase tracking-[0.16em] text-slate-400">Indicators</p>
        <p className="text-xs text-slate-300">
          MACD ({indicatorSettings.macd.fastPeriod},{indicatorSettings.macd.slowPeriod},{indicatorSettings.macd.signalPeriod}) + RSI ({indicatorSettings.rsi.period}) + overlays ({activeOverlayConfigs.length})
        </p>
      </div>

      <IndicatorOverlay chart={mainChartApi} candles={indicatorCandles} overlays={activeOverlayConfigs} />

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
