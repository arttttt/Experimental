import { useMemo, useState } from 'react';

import type { CandleInterval } from '@/domain/models/market/Candle';

export interface ChartTokenOption {
  symbol: string;
  name: string;
}

export type ChartIndicatorKind = 'sma' | 'ema' | 'bollinger' | 'rsi' | 'macd';
type ChartLineWidth = 1 | 2 | 3 | 4;

export interface ChartIndicatorOption {
  id: string;
  kind: ChartIndicatorKind;
  label: string;
  pillLabel: string;
  color: string;
  lineWidth: ChartLineWidth;
  active: boolean;
  period?: number;
  standardDeviationMultiplier?: number;
  fastPeriod?: number;
  slowPeriod?: number;
  signalPeriod?: number;
}

export interface ChartIndicatorPatch {
  color?: string;
  lineWidth?: number;
  period?: number;
  standardDeviationMultiplier?: number;
  fastPeriod?: number;
  slowPeriod?: number;
  signalPeriod?: number;
}

interface ChartToolbarProps {
  selectedTimeframe: CandleInterval;
  onTimeframeChange: (timeframe: CandleInterval) => void;
  selectedTokenSymbol: string;
  tokenOptions: readonly ChartTokenOption[];
  onTokenChange: (symbol: string) => void;
  indicators: readonly ChartIndicatorOption[];
  onIndicatorToggle: (indicatorId: string) => void;
  onIndicatorPatch: (indicatorId: string, patch: ChartIndicatorPatch) => void;
  onIndicatorRemove: (indicatorId: string) => void;
  onResetIndicators: () => void;
  disabled?: boolean;
}

const TIMEFRAMES: CandleInterval[] = ['1m', '5m', '15m', '1h', '4h', '1d'];

export function ChartToolbar(props: ChartToolbarProps) {
  const [isIndicatorMenuOpen, setIsIndicatorMenuOpen] = useState<boolean>(false);
  const [activeIndicatorId, setActiveIndicatorId] = useState<string | null>(null);
  const activeIndicators = useMemo(() => props.indicators.filter((indicator) => indicator.active), [props.indicators]);
  const activeIndicator = useMemo(
    () => props.indicators.find((indicator) => indicator.id === activeIndicatorId) ?? null,
    [activeIndicatorId, props.indicators],
  );

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[0.65rem] uppercase tracking-[0.16em] text-slate-400">Token</p>
        <select
          disabled={props.disabled}
          value={props.selectedTokenSymbol}
          onChange={(event) => props.onTokenChange(event.target.value)}
          className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 transition-colors hover:border-slate-600 focus:border-cyan-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        >
          {props.tokenOptions.map((tokenOption) => (
            <option key={tokenOption.symbol} value={tokenOption.symbol}>
              {tokenOption.symbol} · {tokenOption.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {TIMEFRAMES.map((timeframe) => {
          const isActive = props.selectedTimeframe === timeframe;

          return (
            <button
              key={timeframe}
              type="button"
              disabled={props.disabled}
              onClick={() => props.onTimeframeChange(timeframe)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-cyan-500 text-slate-950'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-slate-100'
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {timeframe}
            </button>
          );
        })}
      </div>

      <div className="mt-3 border-t border-slate-800 pt-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-[0.65rem] uppercase tracking-[0.16em] text-slate-400">Indicators</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={props.disabled}
              onClick={() => setIsIndicatorMenuOpen((isOpen) => !isOpen)}
              className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[0.68rem] text-slate-200 transition-colors hover:border-slate-600 hover:text-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Indicators
            </button>
            <button
              type="button"
              disabled={props.disabled}
              onClick={() => {
                props.onResetIndicators();
                setActiveIndicatorId(null);
              }}
              className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[0.68rem] text-slate-300 transition-colors hover:border-slate-600 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Reset
            </button>
          </div>
        </div>

        {isIndicatorMenuOpen ? (
          <div className="mb-2 rounded-md border border-slate-700 bg-slate-950/80 p-2">
            <div className="space-y-1">
              {props.indicators.map((indicator) => (
                <label
                  key={indicator.id}
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-slate-900/80"
                >
                  <span className="text-xs text-slate-200">{indicator.label}</span>
                  <input
                    type="checkbox"
                    disabled={props.disabled}
                    checked={indicator.active}
                    onChange={() => props.onIndicatorToggle(indicator.id)}
                    className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-cyan-400 focus:ring-cyan-400"
                  />
                </label>
              ))}
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {activeIndicators.length === 0 ? (
            <p className="text-xs text-slate-500">No indicators enabled.</p>
          ) : (
            activeIndicators.map((indicator) => {
              const isSelected = activeIndicatorId === indicator.id;

              return (
                <div
                  key={indicator.id}
                  className={`flex items-center gap-1 rounded-md border px-2 py-1 ${
                    isSelected
                      ? 'border-cyan-400 bg-cyan-400/20 text-cyan-100'
                      : 'border-slate-700 bg-slate-900 text-slate-200'
                  }`}
                >
                  <button
                    type="button"
                    disabled={props.disabled}
                    onClick={() => setActiveIndicatorId((currentId) => (currentId === indicator.id ? null : indicator.id))}
                    className="flex items-center gap-1 text-[0.68rem]"
                  >
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: indicator.color }} />
                    <span>{indicator.pillLabel}</span>
                  </button>
                  <button
                    type="button"
                    disabled={props.disabled}
                    onClick={() => {
                      props.onIndicatorRemove(indicator.id);
                      if (activeIndicatorId === indicator.id) {
                        setActiveIndicatorId(null);
                      }
                    }}
                    className="text-[0.7rem] text-slate-400 transition-colors hover:text-slate-100"
                    aria-label={`Remove ${indicator.label}`}
                  >
                    x
                  </button>
                </div>
              );
            })
          )}
        </div>

        {activeIndicator ? (
          <div className="mt-3 rounded-md border border-slate-700 bg-slate-950/80 p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-slate-100">{activeIndicator.label} settings</p>
              <span className="text-[0.65rem] uppercase tracking-[0.16em] text-slate-500">Live</span>
            </div>

            {(activeIndicator.kind === 'sma' ||
              activeIndicator.kind === 'ema' ||
              activeIndicator.kind === 'rsi' ||
              activeIndicator.kind === 'bollinger') &&
            typeof activeIndicator.period === 'number' ? (
              <label className="mb-2 flex items-center justify-between gap-3 text-xs text-slate-300">
                <span>Period</span>
                <input
                  type="number"
                  min={1}
                  max={400}
                  value={activeIndicator.period}
                  onChange={(event) => props.onIndicatorPatch(activeIndicator.id, { period: Number(event.target.value) })}
                  className="w-24 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 focus:border-cyan-400 focus:outline-none"
                />
              </label>
            ) : null}

            {activeIndicator.kind === 'bollinger' &&
            typeof activeIndicator.standardDeviationMultiplier === 'number' ? (
              <label className="mb-2 flex items-center justify-between gap-3 text-xs text-slate-300">
                <span>Std. dev.</span>
                <input
                  type="number"
                  min={0}
                  max={6}
                  step={0.1}
                  value={activeIndicator.standardDeviationMultiplier}
                  onChange={(event) =>
                    props.onIndicatorPatch(activeIndicator.id, {
                      standardDeviationMultiplier: Number(event.target.value),
                    })
                  }
                  className="w-24 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 focus:border-cyan-400 focus:outline-none"
                />
              </label>
            ) : null}

            {activeIndicator.kind === 'macd' ? (
              <>
                <label className="mb-2 flex items-center justify-between gap-3 text-xs text-slate-300">
                  <span>Fast</span>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={activeIndicator.fastPeriod ?? 12}
                    onChange={(event) =>
                      props.onIndicatorPatch(activeIndicator.id, {
                        fastPeriod: Number(event.target.value),
                      })
                    }
                    className="w-24 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 focus:border-cyan-400 focus:outline-none"
                  />
                </label>
                <label className="mb-2 flex items-center justify-between gap-3 text-xs text-slate-300">
                  <span>Slow</span>
                  <input
                    type="number"
                    min={2}
                    max={300}
                    value={activeIndicator.slowPeriod ?? 26}
                    onChange={(event) =>
                      props.onIndicatorPatch(activeIndicator.id, {
                        slowPeriod: Number(event.target.value),
                      })
                    }
                    className="w-24 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 focus:border-cyan-400 focus:outline-none"
                  />
                </label>
                <label className="mb-2 flex items-center justify-between gap-3 text-xs text-slate-300">
                  <span>Signal</span>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={activeIndicator.signalPeriod ?? 9}
                    onChange={(event) =>
                      props.onIndicatorPatch(activeIndicator.id, {
                        signalPeriod: Number(event.target.value),
                      })
                    }
                    className="w-24 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 focus:border-cyan-400 focus:outline-none"
                  />
                </label>
              </>
            ) : null}

            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="flex items-center justify-between gap-2 text-xs text-slate-300">
                <span>Color</span>
                <input
                  type="color"
                  value={activeIndicator.color}
                  onChange={(event) => props.onIndicatorPatch(activeIndicator.id, { color: event.target.value })}
                  className="h-7 w-10 cursor-pointer rounded border border-slate-700 bg-slate-900"
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-xs text-slate-300">
                <span>Width</span>
                <input
                  type="number"
                  min={1}
                  max={4}
                  value={activeIndicator.lineWidth}
                  onChange={(event) => props.onIndicatorPatch(activeIndicator.id, { lineWidth: Number(event.target.value) })}
                  className="w-16 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 focus:border-cyan-400 focus:outline-none"
                />
              </label>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
