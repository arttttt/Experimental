import type { TradeRecord } from '@/lib/ipc';

const CSV_HEADERS = ['date', 'pair', 'side', 'quantity', 'price', 'commission', 'amount'] as const;
const UTF8_BOM = '\uFEFF';

function formatTradeDate(timestamp: number): string {
  const value = Number(timestamp);
  if (!Number.isFinite(value)) {
    return '';
  }

  return new Date(value).toISOString();
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? String(value) : '0';
}

export function escapeCsvField(value: string): string {
  const escaped = value.replace(/"/g, '""');
  return /[",\n\r]/.test(escaped) ? `"${escaped}"` : escaped;
}

export function toTradeCsv(trades: readonly TradeRecord[]): string {
  const rows = [CSV_HEADERS.join(',')];

  for (const trade of trades) {
    const amount = trade.quantity * trade.price;
    const columns = [
      formatTradeDate(trade.timestamp),
      trade.pair,
      trade.side,
      formatNumber(trade.quantity),
      formatNumber(trade.price),
      formatNumber(trade.fee),
      formatNumber(amount),
    ];
    rows.push(columns.map((column) => escapeCsvField(column)).join(','));
  }

  return `${UTF8_BOM}${rows.join('\r\n')}\r\n`;
}
