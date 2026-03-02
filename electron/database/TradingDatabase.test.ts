import { afterEach, describe, expect, it } from 'vitest'

import { TradingDatabase } from './TradingDatabase'

const databases: TradingDatabase[] = []

const createDatabase = (): TradingDatabase => {
  const database = new TradingDatabase(':memory:')
  databases.push(database)
  return database
}

afterEach(() => {
  while (databases.length > 0) {
    databases.pop()?.close()
  }
})

describe('TradingDatabase', () => {
  it('applies migrations on initialization', () => {
    const database = createDatabase()

    expect(database.getAppliedMigrations()).toEqual([
      '001_create_trades_table',
      '002_create_portfolio_snapshots_table',
    ])
  })

  it('creates and filters trades by pair and date range', () => {
    const database = createDatabase()

    database.createTrade({
      id: 't1',
      pair: 'SOL/USDC',
      side: 'buy',
      quantity: 1,
      price: 100,
      fee: 0.1,
      timestamp: 1000,
      status: 'filled',
    })

    database.createTrade({
      id: 't2',
      pair: 'BTC/USDC',
      side: 'sell',
      quantity: 0.5,
      price: 50_000,
      fee: 1,
      timestamp: 2000,
      status: 'pending',
    })

    database.createTrade({
      id: 't3',
      pair: 'SOL/USDC',
      side: 'sell',
      quantity: 0.4,
      price: 120,
      fee: 0.05,
      timestamp: 3000,
      status: 'filled',
    })

    const pairFiltered = database.listTrades({ pair: 'SOL/USDC' })
    expect(pairFiltered.map((trade) => trade.id)).toEqual(['t3', 't1'])

    const dateFiltered = database.listTrades({
      pair: 'SOL/USDC',
      fromTimestamp: 1500,
      toTimestamp: 3500,
    })
    expect(dateFiltered.map((trade) => trade.id)).toEqual(['t3'])
  })

  it('updates and deletes trades', () => {
    const database = createDatabase()

    database.createTrade({
      id: 't1',
      pair: 'SOL/USDC',
      side: 'buy',
      quantity: 1,
      price: 100,
      timestamp: 1000,
      status: 'pending',
    })

    const updated = database.updateTrade('t1', {
      status: 'filled',
      fee: 0.2,
    })

    expect(updated.status).toBe('filled')
    expect(updated.fee).toBe(0.2)
    expect(database.deleteTrade('t1')).toBe(true)
    expect(database.listTrades()).toEqual([])
  })

  it('stores and filters portfolio snapshots by date range', () => {
    const database = createDatabase()

    database.createPortfolioSnapshot({
      id: 's1',
      capturedAt: 1000,
      totalValue: 1000,
      holdingsJson: JSON.stringify({ SOL: 1 }),
    })

    database.createPortfolioSnapshot({
      id: 's2',
      capturedAt: 2000,
      totalValue: 1200,
      holdingsJson: JSON.stringify({ SOL: 1.2 }),
    })

    database.createPortfolioSnapshot({
      id: 's3',
      capturedAt: 3000,
      totalValue: 1100,
      holdingsJson: JSON.stringify({ SOL: 1.1 }),
    })

    const filtered = database.listPortfolioSnapshots({ fromTimestamp: 1500, toTimestamp: 2500 })
    expect(filtered.map((snapshot) => snapshot.id)).toEqual(['s2'])
    expect(database.deletePortfolioSnapshot('s2')).toBe(true)
    expect(database.listPortfolioSnapshots().map((snapshot) => snapshot.id)).toEqual(['s3', 's1'])
  })
})
