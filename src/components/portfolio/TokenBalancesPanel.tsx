import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { BalanceClient } from '@/data/sources/api/BalanceClient';
import { WalletAddress } from '@/domain/models/id';
import { PortfolioPnlPolicy, type PnlPeriod } from '@/domain/policies/PortfolioPnlPolicy';
import { TOKENS, type TokenConfig } from '@/infrastructure/shared/config';
import { TokenBalancesPanelModel, type BalanceRow } from '@/components/portfolio/TokenBalancesPanelModel';
import { PanelSkeleton, PanelStateMessage } from '@/components/ui/PanelState';
import { toTradeCsv } from '@/components/portfolio/tradeCsv';
import { ipc, type TradeRecord } from '@/lib/ipc';

interface TokenBalancesPanelProps {
  walletAddress: string;
  refreshIntervalMs?: number;
}

interface PriceResponseEntry {
  usdPrice?: unknown;
  price?: unknown;
}

interface PriceResponseBody {
  data?: Record<string, PriceResponseEntry>;
}

interface TradeHistoryFilters {
  pair: string;
  side: TradeSideFilter;
  fromDate: string;
  toDate: string;
}

function isPriceRecord(value: unknown): value is Record<string, PriceResponseEntry> {
  return typeof value === 'object' && value !== null;
}

type LoadMode = 'initial' | 'refresh';
type TradeSideFilter = 'all' | 'buy' | 'sell';

const PNL_PERIOD_OPTIONS: ReadonlyArray<{ value: PnlPeriod; label: string }> = [
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: 'all', label: 'All time' },
];

const DEFAULT_REFRESH_INTERVAL_MS = 30_000;
const PRICE_REQUEST_TIMEOUT_MS = 4_000;
const TRADE_HISTORY_LIMIT = 5_000;
const balanceClient = new BalanceClient();

function formatTokenAmount(value: number): string {
  const fractionDigits = value > 0 && value < 1 ? 8 : 6;

  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: value >= 1_000 ? 2 : 4,
  }).format(value);
}

function formatPercent(value: number): string {
  return `${value.toFixed(2)}%`;
}

function formatSignedUsd(value: number): string {
  if (value > 0) {
    return `+${formatUsd(value)}`;
  }

  if (value < 0) {
    return `-${formatUsd(Math.abs(value))}`;
  }

  return formatUsd(0);
}

function pnlTextColor(value: number): string {
  if (value > 0) {
    return 'text-emerald-300';
  }

  if (value < 0) {
    return 'text-rose-300';
  }

  return 'text-slate-300';
}

function formatTradeTimestamp(timestamp: number): string {
  const value = Number(timestamp);
  if (!Number.isFinite(value)) {
    return '-';
  }

  const asDate = new Date(value);
  if (Number.isNaN(asDate.getTime())) {
    return '-';
  }

  return asDate.toLocaleString();
}

function formatTradePair(pair: string): string {
  return pair && pair.trim().length > 0 ? pair : '-';
}

function formatTradeSide(side: 'buy' | 'sell'): string {
  return side === 'buy' ? 'Buy' : 'Sell';
}

function toDayStartTimestamp(dateText: string): number | undefined {
  if (!dateText) {
    return undefined;
  }

  const asDate = new Date(`${dateText}T00:00:00`);
  const timestamp = asDate.getTime();
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

function toDayEndTimestamp(dateText: string): number | undefined {
  if (!dateText) {
    return undefined;
  }

  const asDate = new Date(`${dateText}T23:59:59.999`);
  const timestamp = asDate.getTime();
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

function toTradeQueryFilters(filters: TradeHistoryFilters): {
  pair?: string;
  fromTimestamp?: number;
  toTimestamp?: number;
} {
  const pair = filters.pair.trim();

  return {
    pair: pair.length > 0 ? pair : undefined,
    fromTimestamp: toDayStartTimestamp(filters.fromDate),
    toTimestamp: toDayEndTimestamp(filters.toDate),
  };
}

async function fetchUsdPrices(tokens: readonly TokenConfig[]): Promise<Map<string, number>> {
  const ids = tokens.map((token) => token.mint.value).join(',');
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, PRICE_REQUEST_TIMEOUT_MS);
  const response = await fetch(`https://api.jup.ag/price/v3?ids=${encodeURIComponent(ids)}`, {
    signal: controller.signal,
  }).finally(() => {
    window.clearTimeout(timeoutId);
  });

  if (!response.ok) {
    throw new Error(`Failed to load USD prices (HTTP ${response.status}).`);
  }

  const payload = (await response.json()) as unknown;
  let priceMap: Record<string, PriceResponseEntry> = {};

  if (isPriceRecord(payload)) {
    const payloadWithData = payload as PriceResponseBody;
    if (isPriceRecord(payloadWithData.data)) {
      priceMap = payloadWithData.data;
    } else {
      priceMap = payload;
    }
  }
  const result = new Map<string, number>();

  for (const token of tokens) {
    const rawEntry = priceMap[token.mint.value];
    const candidatePrice = rawEntry?.usdPrice ?? rawEntry?.price;
    const numericPrice = typeof candidatePrice === 'number' && Number.isFinite(candidatePrice)
      ? candidatePrice
      : TokenBalancesPanelModel.fallbackPriceByToken(token);
    result.set(token.mint.value, numericPrice);
  }

  return result;
}

export function TokenBalancesPanel({
  walletAddress,
  refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MS,
}: TokenBalancesPanelProps) {
  const [rows, setRows] = useState<readonly BalanceRow[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [selectedPnlPeriod, setSelectedPnlPeriod] = useState<PnlPeriod>('24h');
  const [pnlByPeriod, setPnlByPeriod] = useState(() =>
    PortfolioPnlPolicy.calculate({
      trades: [],
      positions: [],
    }).byPeriod,
  );
  const [tradeRows, setTradeRows] = useState<readonly TradeRecord[]>([]);
  const [tradeFilters, setTradeFilters] = useState<TradeHistoryFilters>({
    pair: '',
    side: 'all',
    fromDate: '',
    toDate: '',
  });
  const [isLoadingTrades, setIsLoadingTrades] = useState<boolean>(false);
  const [isExportingCsv, setIsExportingCsv] = useState<boolean>(false);
  const [tradeNotice, setTradeNotice] = useState<string | null>(null);
  const [tradeError, setTradeError] = useState<string | null>(null);
  const requestCounterRef = useRef<number>(0);
  const tradeRequestCounterRef = useRef<number>(0);
  const inFlightRef = useRef<boolean>(false);
  const isMountedRef = useRef<boolean>(true);

  const wallet = useMemo(() => {
    try {
      return new WalletAddress(walletAddress);
    } catch {
      return null;
    }
  }, [walletAddress]);

  const loadBalances = useCallback(async (mode: LoadMode) => {
    if (inFlightRef.current) {
      return;
    }

    if (!wallet) {
      setRows([]);
      setError('Wallet address is invalid.');
      setIsLoading(false);
      setIsRefreshing(false);
      return;
    }

    requestCounterRef.current += 1;
    const requestId = requestCounterRef.current;
    inFlightRef.current = true;

    if (mode === 'refresh') {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    try {
      setError(null);
      const balancesPromise = balanceClient.getAllBalances(wallet, [...TOKENS]);
      const tradesPromise = ipc.db.listTrades({ status: 'filled', limit: TRADE_HISTORY_LIMIT });

      let prices = new Map<string, number>();

      try {
        prices = await fetchUsdPrices(TOKENS);
      } catch {
        prices = TokenBalancesPanelModel.createFallbackPriceMap(TOKENS);
      }

      const [balances, trades] = await Promise.all([balancesPromise, tradesPromise]);

      if (requestId !== requestCounterRef.current) {
        return;
      }

      if (!isMountedRef.current) {
        return;
      }

      const mappedRows = TokenBalancesPanelModel.createBalanceRows(TOKENS, balances, prices);
      const pnlSnapshot = PortfolioPnlPolicy.calculate({
        trades,
        positions: TOKENS.map((token) => ({
          symbol: token.symbol,
          quantity: balances.get(token.mint.value)?.balance ?? 0,
          marketPrice:
            prices.get(token.mint.value) ?? TokenBalancesPanelModel.fallbackPriceByToken(token),
        })),
      });

      setRows(mappedRows);
      setPnlByPeriod(pnlSnapshot.byPeriod);
      setLastUpdatedAt(Date.now());
    } catch (cause) {
      if (requestId !== requestCounterRef.current) {
        return;
      }

      if (!isMountedRef.current) {
        return;
      }

      setError(cause instanceof Error ? cause.message : 'Failed to load balances.');
    } finally {
      if (requestId === requestCounterRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }

      inFlightRef.current = false;
    }
  }, [wallet]);

  const loadTradeHistory = useCallback(async () => {
    const fromTimestamp = toDayStartTimestamp(tradeFilters.fromDate);
    const toTimestamp = toDayEndTimestamp(tradeFilters.toDate);

    if (
      fromTimestamp !== undefined &&
      toTimestamp !== undefined &&
      Number.isFinite(fromTimestamp) &&
      Number.isFinite(toTimestamp) &&
      fromTimestamp > toTimestamp
    ) {
      setTradeRows([]);
      setTradeError('From date must be earlier than or equal to To date.');
      setIsLoadingTrades(false);
      return;
    }

    if (!wallet) {
      setTradeRows([]);
      setTradeError(null);
      setIsLoadingTrades(false);
      return;
    }

    tradeRequestCounterRef.current += 1;
    const requestId = tradeRequestCounterRef.current;
    setIsLoadingTrades(true);
    setTradeError(null);

    try {
      const trades = await ipc.db.listTrades({
        status: 'filled',
        ...toTradeQueryFilters(tradeFilters),
        limit: TRADE_HISTORY_LIMIT,
      });

      if (!isMountedRef.current || requestId !== tradeRequestCounterRef.current) {
        return;
      }

      setTradeRows(trades);
    } catch (cause) {
      if (!isMountedRef.current || requestId !== tradeRequestCounterRef.current) {
        return;
      }

      setTradeRows([]);
      setTradeError(cause instanceof Error ? cause.message : 'Failed to load trade history.');
    } finally {
      if (requestId === tradeRequestCounterRef.current) {
        setIsLoadingTrades(false);
      }
    }
  }, [tradeFilters, wallet]);

  const visibleTrades = useMemo(() => {
    if (tradeFilters.side === 'all') {
      return tradeRows;
    }

    return tradeRows.filter((trade) => trade.side === tradeFilters.side);
  }, [tradeFilters.side, tradeRows]);

  const handleExportCsv = useCallback(async () => {
    if (visibleTrades.length === 0 || isExportingCsv) {
      return;
    }

    setIsExportingCsv(true);
    setTradeNotice(null);

    try {
      const now = new Date();
      const isoDate = now.toISOString().slice(0, 10);
      const saveResult = await ipc.fileDialog.saveTextFile({
        defaultFileName: `trades_${isoDate}.csv`,
        content: toTradeCsv(visibleTrades),
      });

      if (saveResult.saved) {
        setTradeNotice(`CSV exported: ${saveResult.filePath}`);
        return;
      }

      setTradeNotice('CSV export canceled.');
    } catch (cause) {
      setTradeNotice(cause instanceof Error ? cause.message : 'Failed to export CSV.');
    } finally {
      setIsExportingCsv(false);
    }
  }, [isExportingCsv, visibleTrades]);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      requestCounterRef.current += 1;
      tradeRequestCounterRef.current += 1;
    };
  }, []);

  useEffect(() => {
    void loadBalances('initial');
  }, [loadBalances]);

  useEffect(() => {
    void loadTradeHistory();
  }, [loadTradeHistory]);

  useEffect(() => {
    if (!wallet) {
      return;
    }

    if (refreshIntervalMs <= 0) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadBalances('refresh');
    }, refreshIntervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loadBalances, refreshIntervalMs, wallet]);

  const totalUsd = rows.reduce((sum, row) => sum + row.valueUsd, 0);
  const selectedPnl = pnlByPeriod[selectedPnlPeriod];

  return (
    <section className="rounded-2xl border border-slate-800/90 bg-slate-900/70 p-4 shadow-2xl shadow-slate-950/40 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Portfolio</p>
          <h2 className="text-lg font-semibold text-slate-50">Token balances</h2>
          <p className="mt-1 text-sm text-slate-300">
            Total value: <span className="font-semibold text-slate-50">{formatUsd(totalUsd)}</span>
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            void loadBalances('refresh');
          }}
          disabled={isLoading || isRefreshing || !wallet}
          className="rounded-md border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isRefreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      <p className="mt-3 text-xs text-slate-400">
        Wallet:{' '}
          <span className="font-mono text-slate-200" title={walletAddress}>
          {TokenBalancesPanelModel.formatWalletAddress(walletAddress)}
        </span>
      </p>

      <p className="mt-1 text-xs text-slate-500">
        Auto-refresh: every {Math.max(Math.round(refreshIntervalMs / 1000), 1)}s
      </p>

      <div className="mt-4 rounded-lg border border-slate-800/90 bg-slate-950/50 p-3 md:p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Profit &amp; Loss</p>
            <h3 className="text-sm font-semibold text-slate-50">Portfolio PnL</h3>
          </div>

          <div className="flex flex-wrap gap-2" role="tablist" aria-label="PnL period selector">
            {PNL_PERIOD_OPTIONS.map((option) => {
              const isActive = option.value === selectedPnlPeriod;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setSelectedPnlPeriod(option.value);
                  }}
                  className={[
                    'rounded-md border px-2.5 py-1.5 text-xs font-medium transition',
                    isActive
                      ? 'border-cyan-400/70 bg-cyan-500/15 text-cyan-100'
                      : 'border-slate-700 bg-slate-900/70 text-slate-300 hover:border-slate-600 hover:text-slate-100',
                  ].join(' ')}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
          <div className="rounded-md border border-slate-800 bg-slate-900/70 p-3">
            <p className="text-[0.7rem] uppercase tracking-[0.18em] text-slate-500">Realized</p>
            <p className={`mt-1 text-base font-semibold tabular-nums ${pnlTextColor(selectedPnl.realized)}`}>
              {formatSignedUsd(selectedPnl.realized)}
            </p>
          </div>
          <div className="rounded-md border border-slate-800 bg-slate-900/70 p-3">
            <p className="text-[0.7rem] uppercase tracking-[0.18em] text-slate-500">Unrealized</p>
            <p className={`mt-1 text-base font-semibold tabular-nums ${pnlTextColor(selectedPnl.unrealized)}`}>
              {formatSignedUsd(selectedPnl.unrealized)}
            </p>
          </div>
          <div className="rounded-md border border-slate-800 bg-slate-900/70 p-3">
            <p className="text-[0.7rem] uppercase tracking-[0.18em] text-slate-500">Total</p>
            <p className={`mt-1 text-base font-semibold tabular-nums ${pnlTextColor(selectedPnl.total)}`}>
              {formatSignedUsd(selectedPnl.total)}
            </p>
          </div>
        </div>

        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-800/90">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-900/90 text-slate-400">
              <tr>
                <th className="px-3 py-2 font-medium">Asset</th>
                <th className="px-3 py-2 text-right font-medium">Position</th>
                <th className="px-3 py-2 text-right font-medium">Realized</th>
                <th className="px-3 py-2 text-right font-medium">Unrealized</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {selectedPnl.byAsset.map((asset) => (
                <tr key={asset.symbol} className="border-t border-slate-800 text-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-50">{asset.symbol}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-300">
                    {formatTokenAmount(asset.quantity)}
                  </td>
                  <td className={`px-3 py-2 text-right font-medium tabular-nums ${pnlTextColor(asset.realized)}`}>
                    {formatSignedUsd(asset.realized)}
                  </td>
                  <td className={`px-3 py-2 text-right font-medium tabular-nums ${pnlTextColor(asset.unrealized)}`}>
                    {formatSignedUsd(asset.unrealized)}
                  </td>
                  <td className={`px-3 py-2 text-right font-semibold tabular-nums ${pnlTextColor(asset.total)}`}>
                    {formatSignedUsd(asset.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {selectedPnl.byAsset.length === 0 ? (
            <div className="border-t border-slate-800 px-3 py-4 text-sm text-slate-400">No trade history yet.</div>
          ) : null}
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-slate-800/90 bg-slate-950/50 p-3 md:p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Trade History</p>
            <h3 className="text-sm font-semibold text-slate-50">Recent filled trades ({visibleTrades.length})</h3>
          </div>

          <button
            type="button"
            onClick={() => {
              void handleExportCsv();
            }}
            disabled={visibleTrades.length === 0 || isExportingCsv || isLoadingTrades}
            className="rounded-md border border-cyan-500/60 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-100 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isExportingCsv ? 'Exporting...' : 'Export CSV'}
          </button>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <label className="text-xs text-slate-300">
            <span className="mb-1 block text-slate-400">Pair</span>
            <input
              type="text"
              value={tradeFilters.pair}
              onChange={(event) => {
                setTradeFilters((current) => ({
                  ...current,
                  pair: event.target.value.toUpperCase(),
                }));
              }}
              placeholder="SOL/USDC"
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-slate-100"
            />
          </label>

          <label className="text-xs text-slate-300">
            <span className="mb-1 block text-slate-400">Side</span>
            <select
              value={tradeFilters.side}
              onChange={(event) => {
                setTradeFilters((current) => ({
                  ...current,
                  side: event.target.value as TradeSideFilter,
                }));
              }}
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-slate-100"
            >
              <option value="all">All</option>
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
            </select>
          </label>

          <label className="text-xs text-slate-300">
            <span className="mb-1 block text-slate-400">From</span>
            <input
              type="date"
              value={tradeFilters.fromDate}
              onChange={(event) => {
                setTradeFilters((current) => ({
                  ...current,
                  fromDate: event.target.value,
                }));
              }}
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-slate-100"
            />
          </label>

          <label className="text-xs text-slate-300">
            <span className="mb-1 block text-slate-400">To</span>
            <input
              type="date"
              value={tradeFilters.toDate}
              onChange={(event) => {
                setTradeFilters((current) => ({
                  ...current,
                  toDate: event.target.value,
                }));
              }}
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-slate-100"
            />
          </label>
        </div>

        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-800/90">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-slate-900/90 text-slate-400">
              <tr>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Pair</th>
                <th className="px-3 py-2 font-medium">Side</th>
                <th className="px-3 py-2 text-right font-medium">Quantity</th>
                <th className="px-3 py-2 text-right font-medium">Price</th>
                <th className="px-3 py-2 text-right font-medium">Commission</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {visibleTrades.map((trade) => {
                const amount = trade.quantity * trade.price;

                return (
                  <tr key={trade.id} className="border-t border-slate-800 text-slate-200">
                    <td className="px-3 py-2 text-slate-300">{formatTradeTimestamp(trade.timestamp)}</td>
                    <td className="px-3 py-2">{formatTradePair(trade.pair)}</td>
                    <td className="px-3 py-2">
                      <span
                        className={[
                          'rounded border px-2 py-0.5 text-[11px] uppercase tracking-[0.08em]',
                          trade.side === 'buy'
                            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                            : 'border-rose-500/40 bg-rose-500/10 text-rose-200',
                        ].join(' ')}
                      >
                        {formatTradeSide(trade.side)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatTokenAmount(trade.quantity)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatUsd(trade.price)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatUsd(trade.fee)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatUsd(amount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {!isLoadingTrades && visibleTrades.length === 0 ? (
            <div className="border-t border-slate-800 px-3 py-4 text-sm text-slate-400">No trades for active filters.</div>
          ) : null}
        </div>

        {isLoadingTrades ? <p className="mt-3 text-xs text-cyan-300">Loading trade history...</p> : null}
        {tradeError ? <p className="mt-3 text-xs text-red-300">{tradeError}</p> : null}
        {tradeNotice ? <p className="mt-3 text-xs text-slate-300">{tradeNotice}</p> : null}
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-800/90">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-900/90 text-slate-400">
            <tr>
              <th className="px-3 py-2 font-medium">Token</th>
              <th className="px-3 py-2 text-right font-medium">Balance</th>
              <th className="px-3 py-2 text-right font-medium">Price</th>
              <th className="px-3 py-2 text-right font-medium">Value</th>
              <th className="px-3 py-2 text-right font-medium">Allocation</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.mint} className="border-t border-slate-800 text-slate-100">
                <td className="px-3 py-2">
                  <div className="font-medium text-slate-50">{row.symbol}</div>
                  <div className="text-xs text-slate-400">{row.name}</div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatTokenAmount(row.balance)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatUsd(row.unitPriceUsd)}</td>
                <td
                  className={[
                    'px-3 py-2 text-right font-medium tabular-nums',
                    row.valueUsd > 0 ? 'text-emerald-300' : 'text-slate-400',
                  ].join(' ')}
                >
                  {formatUsd(row.valueUsd)}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-3">
                    <progress
                      max={100}
                      value={Math.min(row.allocationPercent, 100)}
                      className="h-2 w-24 overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-slate-800 [&::-webkit-progress-value]:bg-cyan-400 [&::-moz-progress-bar]:bg-cyan-400 md:w-32"
                    />
                    <span className="w-14 text-right text-xs font-medium tabular-nums text-slate-200">
                      {formatPercent(row.allocationPercent)}
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {rows.length === 0 && !isLoading ? (
          <div className="border-t border-slate-800 px-3 py-4 text-sm text-slate-400">No balances yet.</div>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-3">
        <p className="text-xs text-slate-400">
          {lastUpdatedAt ? `Last updated ${new Date(lastUpdatedAt).toLocaleTimeString()}` : 'Not updated yet'}
        </p>
      </div>

      {isLoading ? (
        <div className="mt-3">
          <PanelSkeleton rows={2} />
        </div>
      ) : null}

      {error ? (
        <div className="mt-3">
          <PanelStateMessage
            title="Failed to load portfolio"
            description={error}
            tone="danger"
            actionLabel="Retry"
            onAction={() => {
              void loadBalances('refresh');
            }}
          />
        </div>
      ) : null}
    </section>
  );
}
