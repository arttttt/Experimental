import { describe, expect, it } from 'vitest';

import { PortfolioPnlPolicy } from './PortfolioPnlPolicy';

describe('PortfolioPnlPolicy', () => {
  it('computes realized and unrealized pnl with FIFO', () => {
    const snapshot = PortfolioPnlPolicy.calculate({
      nowTimestamp: 1_000_000,
      positions: [{ symbol: 'SOL', quantity: 1, marketPrice: 140 }],
      trades: [
        {
          pair: 'SOL/USDC',
          side: 'buy',
          quantity: 1,
          price: 100,
          fee: 0,
          timestamp: 10,
          status: 'filled',
        },
        {
          pair: 'SOL/USDC',
          side: 'buy',
          quantity: 1,
          price: 120,
          fee: 0,
          timestamp: 20,
          status: 'filled',
        },
        {
          pair: 'SOL/USDC',
          side: 'sell',
          quantity: 1,
          price: 150,
          fee: 0,
          timestamp: 30,
          status: 'filled',
        },
      ],
    });

    expect(snapshot.byPeriod.all.realized).toBe(50);
    expect(snapshot.byPeriod.all.unrealized).toBe(20);
    expect(snapshot.byPeriod.all.total).toBe(70);
    expect(snapshot.byPeriod.all.byAsset).toEqual([
      {
        symbol: 'SOL',
        quantity: 1,
        marketPrice: 140,
        realized: 50,
        unrealized: 20,
        total: 70,
      },
    ]);
  });

  it('applies period windows to realized and unrealized pnl', () => {
    const nowTimestamp = 31 * 24 * 60 * 60 * 1000;
    const dayMs = 24 * 60 * 60 * 1000;
    const snapshot = PortfolioPnlPolicy.calculate({
      nowTimestamp,
      positions: [{ symbol: 'SOL', quantity: 1.5, marketPrice: 140 }],
      trades: [
        {
          pair: 'SOL/USDC',
          side: 'buy',
          quantity: 1,
          price: 80,
          timestamp: nowTimestamp - 40 * dayMs,
          status: 'filled',
        },
        {
          pair: 'SOL/USDC',
          side: 'sell',
          quantity: 0.5,
          price: 100,
          timestamp: nowTimestamp - 20 * dayMs,
          status: 'filled',
        },
        {
          pair: 'SOL/USDC',
          side: 'buy',
          quantity: 1,
          price: 130,
          timestamp: nowTimestamp - 2 * dayMs,
          status: 'filled',
        },
      ],
    });

    expect(snapshot.byPeriod.all.realized).toBe(10);
    expect(snapshot.byPeriod['30d'].realized).toBe(10);
    expect(snapshot.byPeriod['7d'].realized).toBe(0);
    expect(snapshot.byPeriod['24h'].realized).toBe(0);

    expect(snapshot.byPeriod.all.unrealized).toBe(40);
    expect(snapshot.byPeriod['30d'].unrealized).toBe(10);
    expect(snapshot.byPeriod['7d'].unrealized).toBe(10);
    expect(snapshot.byPeriod['24h'].unrealized).toBe(0);
  });

  it('returns zero pnl when there are no trades and no positions', () => {
    const snapshot = PortfolioPnlPolicy.calculate({
      positions: [],
      trades: [],
      nowTimestamp: 1_000,
    });

    expect(snapshot.byPeriod.all.total).toBe(0);
    expect(snapshot.byPeriod['24h'].byAsset).toEqual([]);
  });

  it('includes unknown assets from trade history', () => {
    const snapshot = PortfolioPnlPolicy.calculate({
      nowTimestamp: 100_000,
      positions: [],
      trades: [
        {
          pair: 'BONK/USDC',
          side: 'buy',
          quantity: 1000,
          price: 0.00001,
          timestamp: 100,
          status: 'filled',
        },
      ],
    });

    expect(snapshot.byPeriod.all.byAsset).toEqual([
      {
        symbol: 'BONK',
        quantity: 1000,
        marketPrice: 0.00001,
        realized: 0,
        unrealized: 0,
        total: 0,
      },
    ]);
  });
});
