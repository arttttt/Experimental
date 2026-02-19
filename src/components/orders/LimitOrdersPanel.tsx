import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  JupiterTriggerClient,
  type TriggerOrderRecord,
} from '@/data/sources/api/JupiterTriggerClient';
import type { MarketTokenDefinition } from '@/domain/constants/MarketTokenRegistry';

interface LimitOrdersPanelProps {
  walletAddress: string;
  tokens: readonly MarketTokenDefinition[];
}

interface ParsedOrder {
  id: string;
  inputMint: string;
  outputMint: string;
  makingAmount: string;
  takingAmount: string;
  createdAt?: string;
  expiresAt?: string;
}

interface OrderDraft {
  inputMint: string;
  outputMint: string;
  makingAmount: string;
  takingAmount: string;
  expiresAt: string;
}

type MintSymbolMap = ReadonlyMap<string, string>;

const triggerClient = new JupiterTriggerClient();

function parseOrder(record: TriggerOrderRecord, index: number): ParsedOrder {
  const id =
    readFirstString(record, ['order', 'orderPubkey', 'publicKey', 'id']) ??
    `unknown-${index + 1}`;

  return {
    id,
    inputMint: readFirstString(record, ['inputMint', 'makingMint']) ?? '-',
    outputMint: readFirstString(record, ['outputMint', 'takingMint']) ?? '-',
    makingAmount: readFirstString(record, ['makingAmount', 'inAmount']) ?? '-',
    takingAmount: readFirstString(record, ['takingAmount', 'outAmount']) ?? '-',
    createdAt: readFirstString(record, ['createdAt', 'creationTime']),
    expiresAt: readFirstString(record, ['expiredAt', 'expiresAt']),
  };
}

function readFirstString(record: TriggerOrderRecord, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }

  return undefined;
}

export function prettyDate(value?: string): string {
  if (!value) {
    return '-';
  }

  const asNumber = Number(value);
  const timestamp = Number.isFinite(asNumber)
    ? (asNumber < 10_000_000_000 ? asNumber * 1000 : asNumber)
    : Date.parse(value);
  const asDate = new Date(timestamp);

  if (Number.isNaN(asDate.getTime())) {
    return value;
  }

  return asDate.toLocaleString();
}

export function shortText(value: string, size = 8): string {
  if (value.length <= size * 2 + 3) {
    return value;
  }

  return `${value.slice(0, size)}...${value.slice(-size)}`;
}

export function isPositiveIntegerString(value: string): boolean {
  return /^\d+$/.test(value) && !/^0+$/.test(value);
}

function formatPair(order: ParsedOrder, tokenByMint: MintSymbolMap): string {
  const inputSymbol = tokenByMint.get(order.inputMint) ?? shortText(order.inputMint, 4);
  const outputSymbol = tokenByMint.get(order.outputMint) ?? shortText(order.outputMint, 4);
  return `${inputSymbol}/${outputSymbol}`;
}

function formatOrderSize(order: ParsedOrder): string {
  return `${order.makingAmount} -> ${order.takingAmount}`;
}

export function LimitOrdersPanel({ walletAddress, tokens }: LimitOrdersPanelProps) {
  const [draft, setDraft] = useState<OrderDraft>(() => ({
    inputMint: tokens[0]?.mint.value ?? '',
    outputMint: tokens[1]?.mint.value ?? tokens[0]?.mint.value ?? '',
    makingAmount: '1000000',
    takingAmount: '1000000',
    expiresAt: '',
  }));
  const [activeOrders, setActiveOrders] = useState<readonly ParsedOrder[]>([]);
  const [historyOrders, setHistoryOrders] = useState<readonly ParsedOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isLoadingOrders, setIsLoadingOrders] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isCancellingOrderId, setIsCancellingOrderId] = useState<string | null>(null);

  const canConfigureOrder = tokens.length >= 2;

  const tokenByMint = useMemo(
    () => new Map(tokens.map((token) => [token.mint.value, token.symbol])),
    [tokens],
  );
  const selectedInputSymbol = tokenByMint.get(draft.inputMint) ?? 'Input';
  const selectedOutputSymbol = tokenByMint.get(draft.outputMint) ?? 'Output';

  const loadOrders = useCallback(async () => {
    if (!walletAddress) {
      setActiveOrders([]);
      setHistoryOrders([]);
      return;
    }

    setIsLoadingOrders(true);

    try {
      setError(null);
      const [activeResponse, historyResponse] = await Promise.all([
        triggerClient.getTriggerOrders({ user: walletAddress, orderStatus: 'active' }),
        triggerClient.getTriggerOrders({ user: walletAddress, orderStatus: 'history' }),
      ]);

      setActiveOrders(activeResponse.orders.map(parseOrder));
      setHistoryOrders(historyResponse.orders.map(parseOrder));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to load orders.');
    } finally {
      setIsLoadingOrders(false);
    }
  }, [walletAddress]);

  const submitOrder = useCallback(async () => {
    if (!canConfigureOrder) {
      setError('At least two tokens are required to create a limit order.');
      return;
    }

    if (!walletAddress.trim()) {
      setError('Wallet address is required to create an order.');
      return;
    }

    const making = draft.makingAmount.trim();
    const taking = draft.takingAmount.trim();
    const expiresAt = draft.expiresAt.trim();

    if (!making || !taking) {
      setError('Both making amount and taking amount are required.');
      return;
    }

    if (!isPositiveIntegerString(making) || !isPositiveIntegerString(taking)) {
      setError('Making amount and taking amount must be positive integers.');
      return;
    }

    if (expiresAt.length > 0 && !isPositiveIntegerString(expiresAt)) {
      setError('Expires at must be a unix timestamp in seconds.');
      return;
    }

    if (draft.inputMint === draft.outputMint) {
      setError('Input and output token must be different.');
      return;
    }

    setIsSubmitting(true);

    try {
      setError(null);
      setNotice(null);

      const created = await triggerClient.createOrder({
        inputMint: draft.inputMint,
        outputMint: draft.outputMint,
        maker: walletAddress,
        payer: walletAddress,
        params: {
          makingAmount: making,
          takingAmount: taking,
          ...(expiresAt.length > 0 ? { expiredAt: expiresAt } : {}),
        },
      });

      setNotice(`Order submitted. Transaction: ${shortText(created.transaction, 12)}`);
      await loadOrders();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to create order.');
    } finally {
      setIsSubmitting(false);
    }
  }, [canConfigureOrder, draft, loadOrders, walletAddress]);

  const cancelOrder = useCallback(
    async (orderId: string) => {
      if (!walletAddress.trim()) {
        setError('Wallet address is required to cancel an order.');
        return;
      }

      setIsCancellingOrderId(orderId);

      try {
        setError(null);
        setNotice(null);
        const cancelled = await triggerClient.cancelOrder({
          maker: walletAddress,
          order: orderId,
        });

        setNotice(`Cancel submitted. Transaction: ${shortText(cancelled.transaction, 12)}`);
        await loadOrders();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Failed to cancel order.');
      } finally {
        setIsCancellingOrderId(null);
      }
    },
    [loadOrders, walletAddress],
  );

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-2xl shadow-slate-950/40 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Limit orders</p>
          <h2 className="text-lg font-semibold text-slate-50">Create, monitor, and cancel</h2>
        </div>

        <button
          type="button"
          onClick={() => {
            void loadOrders();
          }}
          disabled={isLoadingOrders || isSubmitting || isCancellingOrderId !== null}
          className="rounded-md border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoadingOrders ? 'Refreshing...' : 'Refresh orders'}
        </button>
      </div>

      <p className="mt-3 text-xs text-slate-400">
        Maker wallet: <span className="font-mono text-slate-200">{shortText(walletAddress, 10)}</span>
      </p>

      <div className="mt-4 grid gap-3 rounded-lg border border-slate-800/80 bg-slate-950/40 p-3 md:grid-cols-2">
        <label className="text-xs text-slate-300">
          <span className="mb-1 block text-slate-400">Sell token</span>
          <select
            value={draft.inputMint}
            onChange={(event) => {
              setDraft((current) => ({ ...current, inputMint: event.target.value }));
            }}
            disabled={tokens.length === 0}
            className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-slate-100"
          >
            {tokens.length === 0 ? (
              <option value="">No tokens available</option>
            ) : (
              tokens.map((token) => (
                <option key={token.mint.value} value={token.mint.value}>
                  {token.symbol}
                </option>
              ))
            )}
          </select>
        </label>

        <label className="text-xs text-slate-300">
          <span className="mb-1 block text-slate-400">Buy token</span>
          <select
            value={draft.outputMint}
            onChange={(event) => {
              setDraft((current) => ({ ...current, outputMint: event.target.value }));
            }}
            disabled={tokens.length === 0}
            className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-slate-100"
          >
            {tokens.length === 0 ? (
              <option value="">No tokens available</option>
            ) : (
              tokens.map((token) => (
                <option key={token.mint.value} value={token.mint.value}>
                  {token.symbol}
                </option>
              ))
            )}
          </select>
        </label>

        <label className="text-xs text-slate-300">
          <span className="mb-1 block text-slate-400">Making amount (raw units)</span>
          <input
            value={draft.makingAmount}
            onChange={(event) => {
              setDraft((current) => ({ ...current, makingAmount: event.target.value }));
            }}
            className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-slate-100"
            placeholder="1000000"
          />
        </label>

        <label className="text-xs text-slate-300">
          <span className="mb-1 block text-slate-400">Taking amount (raw units)</span>
          <input
            value={draft.takingAmount}
            onChange={(event) => {
              setDraft((current) => ({ ...current, takingAmount: event.target.value }));
            }}
            className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-slate-100"
            placeholder="900000"
          />
        </label>

        <label className="text-xs text-slate-300 md:col-span-2">
          <span className="mb-1 block text-slate-400">Expires at (unix seconds, optional)</span>
          <input
            value={draft.expiresAt}
            onChange={(event) => {
              setDraft((current) => ({ ...current, expiresAt: event.target.value }));
            }}
            className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-slate-100"
            placeholder="1737075600"
          />
        </label>

        <div className="md:col-span-2">
          <button
            type="button"
            onClick={() => {
              void submitOrder();
            }}
            disabled={isSubmitting || !canConfigureOrder}
            className="rounded-md border border-cyan-500/60 bg-cyan-500/10 px-3 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? 'Submitting...' : `Create ${selectedInputSymbol}/${selectedOutputSymbol} order`}
          </button>
        </div>
      </div>

      {!canConfigureOrder ? (
        <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          Add at least two market tokens to enable limit order creation.
        </p>
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-800/90 bg-slate-950/50">
          <div className="border-b border-slate-800 px-3 py-2">
            <h3 className="text-sm font-semibold text-slate-100">Active orders ({activeOrders.length})</h3>
          </div>

          <div className="max-h-72 overflow-auto">
            {activeOrders.length === 0 ? (
              <p className="px-3 py-4 text-sm text-slate-400">No active orders.</p>
            ) : (
              <table className="min-w-full text-left text-xs">
                <thead className="bg-slate-900/90 text-slate-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">Pair</th>
                    <th className="px-3 py-2 font-medium">Size</th>
                    <th className="px-3 py-2 font-medium">Created</th>
                    <th className="px-3 py-2 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {activeOrders.map((order) => {
                    return (
                      <tr key={order.id} className="border-t border-slate-800 text-slate-200">
                        <td className="px-3 py-2">
                          <div>{formatPair(order, tokenByMint)}</div>
                          <div className="font-mono text-[11px] text-slate-500">{shortText(order.id, 10)}</div>
                        </td>
                        <td className="px-3 py-2 font-mono text-[11px]">
                          {formatOrderSize(order)}
                        </td>
                        <td className="px-3 py-2 text-slate-400">{prettyDate(order.createdAt)}</td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            disabled={order.id.startsWith('unknown-') || isCancellingOrderId === order.id}
                            onClick={() => {
                              void cancelOrder(order.id);
                            }}
                            className="rounded border border-rose-500/50 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isCancellingOrderId === order.id ? 'Canceling...' : 'Cancel'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-slate-800/90 bg-slate-950/50">
          <div className="border-b border-slate-800 px-3 py-2">
            <h3 className="text-sm font-semibold text-slate-100">Order history ({historyOrders.length})</h3>
          </div>

          <div className="max-h-72 overflow-auto">
            {historyOrders.length === 0 ? (
              <p className="px-3 py-4 text-sm text-slate-400">No historical orders yet.</p>
            ) : (
              <table className="min-w-full text-left text-xs">
                <thead className="bg-slate-900/90 text-slate-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">Pair</th>
                    <th className="px-3 py-2 font-medium">Size</th>
                    <th className="px-3 py-2 font-medium">Expires</th>
                  </tr>
                </thead>
                <tbody>
                  {historyOrders.map((order) => {
                    return (
                      <tr key={order.id} className="border-t border-slate-800 text-slate-200">
                        <td className="px-3 py-2">{formatPair(order, tokenByMint)}</td>
                        <td className="px-3 py-2 font-mono text-[11px]">
                          {formatOrderSize(order)}
                        </td>
                        <td className="px-3 py-2 text-slate-400">{prettyDate(order.expiresAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {notice ? (
        <p className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          {notice}
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}
    </section>
  );
}
