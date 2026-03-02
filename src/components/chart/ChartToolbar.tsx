import type { CandleInterval } from '@/domain/models/market/Candle';

export interface ChartTokenOption {
  symbol: string;
  name: string;
}

export interface ChartOverlayOption {
  id: string;
  label: string;
  color: string;
  active: boolean;
}

interface ChartToolbarProps {
  selectedTimeframe: CandleInterval;
  onTimeframeChange: (timeframe: CandleInterval) => void;
  selectedTokenSymbol: string;
  tokenOptions: readonly ChartTokenOption[];
  onTokenChange: (symbol: string) => void;
  overlays: readonly ChartOverlayOption[];
  onOverlayToggle: (overlayId: string) => void;
  disabled?: boolean;
}

const TIMEFRAMES: CandleInterval[] = ['1m', '5m', '15m', '1h', '4h', '1d'];

export function ChartToolbar(props: ChartToolbarProps) {
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
        <p className="mb-2 text-[0.65rem] uppercase tracking-[0.16em] text-slate-400">Overlays</p>
        <div className="flex flex-wrap items-center gap-2">
          {props.overlays.map((overlay) => (
            <button
              key={overlay.id}
              type="button"
              disabled={props.disabled}
              onClick={() => props.onOverlayToggle(overlay.id)}
              className={`rounded-md border px-2 py-1 text-[0.68rem] transition-colors ${
                overlay.active
                  ? 'text-slate-950'
                  : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600 hover:text-slate-100'
              } disabled:cursor-not-allowed disabled:opacity-60`}
              style={
                overlay.active
                  ? {
                      borderColor: overlay.color,
                      backgroundColor: overlay.color,
                    }
                  : undefined
              }
            >
              {overlay.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
