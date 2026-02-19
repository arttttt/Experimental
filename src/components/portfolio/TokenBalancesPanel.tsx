import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { BalanceClient } from '@/data/sources/api/BalanceClient';
import { WalletAddress } from '@/domain/models/id';
import { TOKENS, type TokenConfig } from '@/infrastructure/shared/config';
import { TokenBalancesPanelModel, type BalanceRow } from '@/components/portfolio/TokenBalancesPanelModel';

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
      const balances = await balanceClient.getAllBalances(wallet, [...TOKENS]);
      let prices = new Map<string, number>();

      try {
        prices = await fetchUsdPrices(TOKENS);
      } catch {
        prices = TokenBalancesPanelModel.createFallbackPriceMap(TOKENS);
      }

      if (requestId !== requestCounterRef.current) {
        return;
      }

      if (!isMountedRef.current) {
        return;
      }

      const mappedRows = TokenBalancesPanelModel.createBalanceRows(TOKENS, balances, prices);

      setRows(mappedRows);
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

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-2xl shadow-slate-950/40 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Portfolio</p>
          <h2 className="text-lg font-semibold text-slate-50">Token balances</h2>
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

      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-800/90">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-900/90 text-slate-400">
            <tr>
              <th className="px-3 py-2 font-medium">Token</th>
              <th className="px-3 py-2 text-right font-medium">Balance</th>
              <th className="px-3 py-2 text-right font-medium">Price</th>
              <th className="px-3 py-2 text-right font-medium">Value</th>
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
              </tr>
            ))}
          </tbody>
        </table>

        {rows.length === 0 && !isLoading ? (
          <div className="border-t border-slate-800 px-3 py-4 text-sm text-slate-400">No balances yet.</div>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-3">
        <p className="text-sm text-slate-300">
          Total value: <span className="font-semibold text-slate-50">{formatUsd(totalUsd)}</span>
        </p>

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
