import type { CandleTimeframe } from '@/features/market-data/BirdeyeMarketDataClient';

interface ChartToolbarProps {
  selectedTimeframe: CandleTimeframe;
  onTimeframeChange: (timeframe: CandleTimeframe) => void;
  disabled?: boolean;
}

const TIMEFRAMES: CandleTimeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d'];

export function ChartToolbar(props: ChartToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/70 p-2">
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
  );
}
