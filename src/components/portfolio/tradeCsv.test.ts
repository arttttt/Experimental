import { describe, expect, it } from 'vitest';

import type { TradeRecord } from '@/lib/ipc';
import { escapeCsvField, toTradeCsv } from '@/components/portfolio/tradeCsv';

const SAMPLE_TRADE: TradeRecord = {
  id: 't-1',
  pair: 'SOL/USDC',
  side: 'buy',
  quantity: 1.25,
  price: 120.5,
  fee: 0.11,
  timestamp: Date.UTC(2026, 2, 3, 10, 30, 0),
  status: 'filled',
  createdAt: 1,
  updatedAt: 1,
};

describe('tradeCsv', () => {
  it('escapes quotes and commas for csv fields', () => {
    expect(escapeCsvField('SOL,USDC')).toBe('"SOL,USDC"');
    expect(escapeCsvField('pair "quoted"')).toBe('"pair ""quoted"""');
  });

  it('serializes trade rows with english headers', () => {
    const csv = toTradeCsv([SAMPLE_TRADE]);

    expect(csv.startsWith('\uFEFFdate,pair,side,quantity,price,commission,amount\r\n')).toBe(true);
    expect(csv).toContain('SOL/USDC,buy,1.25,120.5,0.11,150.625');
  });

  it('keeps special characters valid in csv output', () => {
    const csv = toTradeCsv([
      {
        ...SAMPLE_TRADE,
        pair: 'SOL,"USDC"\nSpot',
      },
    ]);

    expect(csv).toContain('"SOL,""USDC""\nSpot"');
  });
});
