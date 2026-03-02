import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { BalanceClient } from '@/data/sources/api/BalanceClient';
import { WalletAddress } from '@/domain/models/id';
import { PortfolioPnlPolicy, type PnlPeriod } from '@/domain/policies/PortfolioPnlPolicy';
import { TOKENS, type TokenConfig } from '@/infrastructure/shared/config';
import { TokenBalancesPanelModel, type BalanceRow } from '@/components/portfolio/TokenBalancesPanelModel';
import { ipc } from '@/lib/ipc';

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

function isPriceRecord(value: unknown): value is Record<string, PriceResponseEntry> {
  return typeof value === 'object' && value !== null;
}

type LoadMode = 'initial' | 'refresh';

const PNL_PERIOD_OPTIONS: ReadonlyArray<{ value: PnlPeriod; label: string }> = [
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: 'all', label: 'All time' },
];

const DEFAULT_REFRESH_INTERVAL_MS = 30_000;
const PRICE_REQUEST_TIMEOUT_MS = 4_000;
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
  const requestCounterRef = useRef<number>(0);
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
      const tradesPromise = ipc.db.listTrades({ status: 'filled', limit: 5_000 });

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

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      requestCounterRef.current += 1;
    };
  }, []);

  useEffect(() => {
    void loadBalances('initial');
  }, [loadBalances]);

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
    <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-2xl shadow-slate-950/40 md:p-5">
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

      {isLoading ? <p className="mt-3 text-sm text-cyan-300">Loading balances...</p> : null}

      {error ? (
        <p className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
      ) : null}
    </section>
  );
}
