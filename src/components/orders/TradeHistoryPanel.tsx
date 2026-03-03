import { useCallback, useEffect, useMemo, useState } from 'react';

import { ipc, type TradeRecord, type TradeSide } from '@/lib/ipc';

const PAGE_SIZE = 50;
const FETCH_BATCH_SIZE = 1_000;

type SortColumn =
  | 'timestamp'
  | 'pair'
  | 'side'
  | 'quantity'
  | 'price'
  | 'fee'
  | 'total';

type SortDirection = 'asc' | 'desc';

interface TradeHistoryFilters {
  pair: string;
  side: 'all' | TradeSide;
  fromDateTime: string;
  toDateTime: string;
}

function normalizeTradeTimestamp(timestamp: number): number {
  return timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
}

function formatDateTime(timestamp: number): string {
  const date = new Date(normalizeTradeTimestamp(timestamp));

  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return date.toLocaleString();
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 8,
  }).format(value);
}

function toEpochMs(value: string): number | undefined {
  if (value.trim().length === 0) {
    return undefined;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function compareTrades(a: TradeRecord, b: TradeRecord, column: SortColumn, direction: SortDirection): number {
  const sign = direction === 'asc' ? 1 : -1;
  const aTimestamp = normalizeTradeTimestamp(a.timestamp);
  const bTimestamp = normalizeTradeTimestamp(b.timestamp);
  const aTotal = a.quantity * a.price;
  const bTotal = b.quantity * b.price;

  switch (column) {
    case 'timestamp':
      return (aTimestamp - bTimestamp) * sign;
    case 'pair':
      return a.pair.localeCompare(b.pair) * sign;
    case 'side':
      return a.side.localeCompare(b.side) * sign;
    case 'quantity':
      return (a.quantity - b.quantity) * sign;
    case 'price':
      return (a.price - b.price) * sign;
    case 'fee':
      return (a.fee - b.fee) * sign;
    case 'total':
      return (aTotal - bTotal) * sign;
    default:
      return 0;
  }
}

export function TradeHistoryPanel() {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [trades, setTrades] = useState<readonly TradeRecord[]>([]);
  const [filters, setFilters] = useState<TradeHistoryFilters>({
    pair: 'all',
    side: 'all',
    fromDateTime: '',
    toDateTime: '',
  });
  const [sortColumn, setSortColumn] = useState<SortColumn>('timestamp');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [page, setPage] = useState<number>(1);

  const loadTrades = useCallback(async () => {
    setIsLoading(true);

    try {
      setError(null);

      const allTrades: TradeRecord[] = [];
      let offset = 0;

      while (true) {
        const chunk = await ipc.db.listTrades({
          limit: FETCH_BATCH_SIZE,
          offset,
        });

        allTrades.push(...chunk);

        if (chunk.length < FETCH_BATCH_SIZE) {
          break;
        }

        offset += FETCH_BATCH_SIZE;
      }

      setTrades(allTrades);
      setPage(1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to load trade history.');
      setTrades([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTrades();
  }, [loadTrades]);

  const pairs = useMemo(() => {
    return Array.from(new Set(trades.map((trade) => trade.pair))).sort((left, right) => {
      return left.localeCompare(right);
    });
  }, [trades]);

  const filteredTrades = useMemo(() => {
    const fromTimestamp = toEpochMs(filters.fromDateTime);
    const toTimestamp = toEpochMs(filters.toDateTime);
    const hasInvalidRange =
      fromTimestamp !== undefined &&
      toTimestamp !== undefined &&
      fromTimestamp > toTimestamp;

    if (hasInvalidRange) {
      return [];
    }

    return trades.filter((trade) => {
      const tradeTimestamp = normalizeTradeTimestamp(trade.timestamp);

      if (filters.pair !== 'all' && trade.pair !== filters.pair) {
        return false;
      }

      if (filters.side !== 'all' && trade.side !== filters.side) {
        return false;
      }

      if (fromTimestamp !== undefined && tradeTimestamp < fromTimestamp) {
        return false;
      }

      if (toTimestamp !== undefined && tradeTimestamp > toTimestamp) {
        return false;
      }

      return true;
    });
  }, [filters.fromDateTime, filters.pair, filters.side, filters.toDateTime, trades]);

  const hasInvalidDateRange = useMemo(() => {
    const fromTimestamp = toEpochMs(filters.fromDateTime);
    const toTimestamp = toEpochMs(filters.toDateTime);

    return (
      fromTimestamp !== undefined &&
      toTimestamp !== undefined &&
      fromTimestamp > toTimestamp
    );
  }, [filters.fromDateTime, filters.toDateTime]);

  const sortedTrades = useMemo(() => {
    return [...filteredTrades].sort((left, right) => {
      return compareTrades(left, right, sortColumn, sortDirection);
    });
  }, [filteredTrades, sortColumn, sortDirection]);

  const totalRows = sortedTrades.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginatedTrades = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return sortedTrades.slice(start, start + PAGE_SIZE);
  }, [currentPage, sortedTrades]);

  useEffect(() => {
    if (page !== currentPage) {
      setPage(currentPage);
    }
  }, [currentPage, page]);

  const toggleSort = (column: SortColumn) => {
    setPage(1);
    if (sortColumn === column) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }

    setSortColumn(column);
    setSortDirection(column === 'timestamp' ? 'desc' : 'asc');
  };

  const sortIndicator = (column: SortColumn): string => {
    if (sortColumn !== column) {
      return '↕';
    }

    return sortDirection === 'asc' ? '↑' : '↓';
  };

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-2xl shadow-slate-950/40 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Trade history</p>
          <h2 className="text-lg font-semibold text-slate-50">Executed trades</h2>
        </div>

        <button
          type="button"
          onClick={() => {
            void loadTrades();
          }}
          disabled={isLoading}
          className="rounded-md border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading ? 'Refreshing...' : 'Refresh history'}
        </button>
      </div>

      <div className="mt-4 grid gap-3 rounded-lg border border-slate-800/80 bg-slate-950/40 p-3 md:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs text-slate-300">
          <span className="mb-1 block text-slate-400">Pair</span>
          <select
            value={filters.pair}
            onChange={(event) => {
              setFilters((current) => ({ ...current, pair: event.target.value }));
              setPage(1);
            }}
            className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-slate-100"
          >
            <option value="all">All pairs</option>
            {pairs.map((pair) => (
              <option key={pair} value={pair}>
                {pair}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs text-slate-300">
          <span className="mb-1 block text-slate-400">Side</span>
          <select
            value={filters.side}
            onChange={(event) => {
              setFilters((current) => ({
                ...current,
                side: event.target.value as TradeHistoryFilters['side'],
              }));
              setPage(1);
            }}
            className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-slate-100"
          >
            <option value="all">All sides</option>
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </select>
        </label>

        <label className="text-xs text-slate-300">
          <span className="mb-1 block text-slate-400">From</span>
          <input
            type="datetime-local"
            value={filters.fromDateTime}
            onChange={(event) => {
              setFilters((current) => ({ ...current, fromDateTime: event.target.value }));
              setPage(1);
            }}
            className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-slate-100"
          />
        </label>

        <label className="text-xs text-slate-300">
          <span className="mb-1 block text-slate-400">To</span>
          <input
            type="datetime-local"
            value={filters.toDateTime}
            onChange={(event) => {
              setFilters((current) => ({ ...current, toDateTime: event.target.value }));
              setPage(1);
            }}
            className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-slate-100"
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setFilters({
              pair: 'all',
              side: 'all',
              fromDateTime: '',
              toDateTime: '',
            });
            setPage(1);
          }}
          disabled={
            filters.pair === 'all' &&
            filters.side === 'all' &&
            filters.fromDateTime.length === 0 &&
            filters.toDateTime.length === 0
          }
          className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 transition hover:border-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Clear filters
        </button>
      </div>

      <p className="mt-3 text-xs text-slate-400">
        Total trades: <span className="font-medium text-slate-200">{totalRows}</span>
      </p>

      {hasInvalidDateRange ? (
        <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          Invalid date range: "From" must be earlier than "To".
        </p>
      ) : null}

      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-800/90 bg-slate-950/50">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-slate-900/90 text-slate-400">
            <tr>
              <th className="px-3 py-2 font-medium">
                <button type="button" onClick={() => toggleSort('timestamp')} className="inline-flex items-center gap-1">
                  Date/Time {sortIndicator('timestamp')}
                </button>
              </th>
              <th className="px-3 py-2 font-medium">
                <button type="button" onClick={() => toggleSort('pair')} className="inline-flex items-center gap-1">
                  Pair {sortIndicator('pair')}
                </button>
              </th>
              <th className="px-3 py-2 font-medium">
                <button type="button" onClick={() => toggleSort('side')} className="inline-flex items-center gap-1">
                  Side {sortIndicator('side')}
                </button>
              </th>
              <th className="px-3 py-2 font-medium">
                <button type="button" onClick={() => toggleSort('quantity')} className="inline-flex items-center gap-1">
                  Quantity {sortIndicator('quantity')}
                </button>
              </th>
              <th className="px-3 py-2 font-medium">
                <button type="button" onClick={() => toggleSort('price')} className="inline-flex items-center gap-1">
                  Executed price {sortIndicator('price')}
                </button>
              </th>
              <th className="px-3 py-2 font-medium">
                <button type="button" onClick={() => toggleSort('fee')} className="inline-flex items-center gap-1">
                  Fee {sortIndicator('fee')}
                </button>
              </th>
              <th className="px-3 py-2 font-medium">
                <button type="button" onClick={() => toggleSort('total')} className="inline-flex items-center gap-1">
                  Total {sortIndicator('total')}
                </button>
              </th>
            </tr>
          </thead>

          <tbody>
            {paginatedTrades.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-sm text-slate-400">
                  {isLoading
                    ? 'Loading trade history...'
                    : trades.length === 0
                      ? 'No trades saved yet.'
                      : 'No trades match current filters.'}
                </td>
              </tr>
            ) : (
              paginatedTrades.map((trade) => {
                const total = trade.quantity * trade.price;
                const sideClass =
                  trade.side === 'buy'
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                    : 'border-rose-500/30 bg-rose-500/10 text-rose-200';

                return (
                  <tr key={trade.id} className="border-t border-slate-800 text-slate-200">
                    <td className="px-3 py-2 text-slate-300">{formatDateTime(trade.timestamp)}</td>
                    <td className="px-3 py-2 font-medium">{trade.pair}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded border px-2 py-0.5 text-[11px] font-semibold uppercase ${sideClass}`}>
                        {trade.side}
                      </span>
                    </td>
                    <td className="px-3 py-2">{formatNumber(trade.quantity)}</td>
                    <td className="px-3 py-2">{formatNumber(trade.price)}</td>
                    <td className="px-3 py-2">{formatNumber(trade.fee)}</td>
                    <td className="px-3 py-2">{formatNumber(total)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
        <span>
          Page {currentPage} of {totalPages} · {PAGE_SIZE} rows per page
        </span>

        <span>
          Showing {totalRows === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1}-
          {Math.min(currentPage * PAGE_SIZE, totalRows)} of {totalRows}
        </span>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setPage((current) => Math.max(1, current - 1));
            }}
            disabled={currentPage <= 1}
            className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200 transition hover:border-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Prev
          </button>

          <button
            type="button"
            onClick={() => {
              setPage((current) => Math.min(totalPages, current + 1));
            }}
            disabled={currentPage >= totalPages}
            className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200 transition hover:border-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>

      {error ? (
        <p className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
      ) : null}
    </section>
  );
}
