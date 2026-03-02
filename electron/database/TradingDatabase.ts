import Database from 'better-sqlite3'

export type TradeSide = 'buy' | 'sell'
export type TradeStatus = 'pending' | 'filled' | 'cancelled' | 'failed'

export type TradeRecord = Readonly<{
  id: string
  pair: string
  side: TradeSide
  quantity: number
  price: number
  fee: number
  timestamp: number
  status: TradeStatus
  createdAt: number
  updatedAt: number
}>

export type CreateTradeInput = Readonly<{
  id: string
  pair: string
  side: TradeSide
  quantity: number
  price: number
  fee?: number
  timestamp: number
  status?: TradeStatus
}>

export type UpdateTradeInput = Readonly<{
  pair?: string
  side?: TradeSide
  quantity?: number
  price?: number
  fee?: number
  timestamp?: number
  status?: TradeStatus
}>

export type TradeFilters = Readonly<{
  pair?: string
  status?: TradeStatus
  fromTimestamp?: number
  toTimestamp?: number
  limit?: number
  offset?: number
}>

export type PortfolioSnapshotRecord = Readonly<{
  id: string
  capturedAt: number
  totalValue: number
  holdingsJson: string
  createdAt: number
}>

export type CreatePortfolioSnapshotInput = Readonly<{
  id: string
  capturedAt: number
  totalValue: number
  holdingsJson: string
}>

export type PortfolioSnapshotFilters = Readonly<{
  fromTimestamp?: number
  toTimestamp?: number
  limit?: number
  offset?: number
}>

type Migration = Readonly<{
  name: string
  sql: string
}>

const MIGRATIONS: ReadonlyArray<Migration> = [
  {
    name: '001_create_trades_table',
    sql: `
      CREATE TABLE IF NOT EXISTS trades (
        id TEXT PRIMARY KEY,
        pair TEXT NOT NULL,
        side TEXT NOT NULL CHECK(side IN ('buy', 'sell')),
        quantity REAL NOT NULL,
        price REAL NOT NULL,
        fee REAL NOT NULL DEFAULT 0,
        timestamp INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'filled', 'cancelled', 'failed')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_trades_pair_timestamp
        ON trades(pair, timestamp DESC);

      CREATE INDEX IF NOT EXISTS idx_trades_timestamp
        ON trades(timestamp DESC);
    `,
  },
  {
    name: '002_create_portfolio_snapshots_table',
    sql: `
      CREATE TABLE IF NOT EXISTS portfolio_snapshots (
        id TEXT PRIMARY KEY,
        captured_at INTEGER NOT NULL,
        total_value REAL NOT NULL,
        holdings_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_captured_at
        ON portfolio_snapshots(captured_at DESC);
    `,
  },
]

export class TradingDatabase {
  private readonly db: Database.Database

  public constructor(databasePath: string) {
    this.db = new Database(databasePath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.applyMigrations()
  }

  public createTrade(input: CreateTradeInput): TradeRecord {
    const now = Date.now()
    this.db
      .prepare(
        `
          INSERT INTO trades (
            id, pair, side, quantity, price, fee, timestamp, status, created_at, updated_at
          ) VALUES (
            @id, @pair, @side, @quantity, @price, @fee, @timestamp, @status, @createdAt, @updatedAt
          )
        `,
      )
      .run({
        id: input.id,
        pair: input.pair,
        side: input.side,
        quantity: input.quantity,
        price: input.price,
        fee: input.fee ?? 0,
        timestamp: input.timestamp,
        status: input.status ?? 'pending',
        createdAt: now,
        updatedAt: now,
      })

    return this.getTradeById(input.id)
  }

  public getTradeById(id: string): TradeRecord {
    const row = this.db
      .prepare(
        `
          SELECT
            id,
            pair,
            side,
            quantity,
            price,
            fee,
            timestamp,
            status,
            created_at AS createdAt,
            updated_at AS updatedAt
          FROM trades
          WHERE id = ?
        `,
      )
      .get(id) as TradeRecord | undefined

    if (!row) {
      throw new Error(`Trade not found: ${id}`)
    }

    return row
  }

  public listTrades(filters?: TradeFilters): ReadonlyArray<TradeRecord> {
    const whereClauses: string[] = []
    const params: Record<string, unknown> = {}

    if (filters?.pair) {
      whereClauses.push('pair = @pair')
      params.pair = filters.pair
    }

    if (filters?.status) {
      whereClauses.push('status = @status')
      params.status = filters.status
    }

    if (filters?.fromTimestamp !== undefined) {
      whereClauses.push('timestamp >= @fromTimestamp')
      params.fromTimestamp = filters.fromTimestamp
    }

    if (filters?.toTimestamp !== undefined) {
      whereClauses.push('timestamp <= @toTimestamp')
      params.toTimestamp = filters.toTimestamp
    }

    params.limit = Math.max(1, Math.min(filters?.limit ?? 500, 5_000))
    params.offset = Math.max(0, filters?.offset ?? 0)

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''

    return this.db
      .prepare(
        `
          SELECT
            id,
            pair,
            side,
            quantity,
            price,
            fee,
            timestamp,
            status,
            created_at AS createdAt,
            updated_at AS updatedAt
          FROM trades
          ${whereSql}
          ORDER BY timestamp DESC
          LIMIT @limit
          OFFSET @offset
        `,
      )
      .all(params) as ReadonlyArray<TradeRecord>
  }

  public updateTrade(id: string, patch: UpdateTradeInput): TradeRecord {
    const assignments: string[] = []
    const params: Record<string, unknown> = { id }

    if (patch.pair !== undefined) {
      assignments.push('pair = @pair')
      params.pair = patch.pair
    }

    if (patch.side !== undefined) {
      assignments.push('side = @side')
      params.side = patch.side
    }

    if (patch.quantity !== undefined) {
      assignments.push('quantity = @quantity')
      params.quantity = patch.quantity
    }

    if (patch.price !== undefined) {
      assignments.push('price = @price')
      params.price = patch.price
    }

    if (patch.fee !== undefined) {
      assignments.push('fee = @fee')
      params.fee = patch.fee
    }

    if (patch.timestamp !== undefined) {
      assignments.push('timestamp = @timestamp')
      params.timestamp = patch.timestamp
    }

    if (patch.status !== undefined) {
      assignments.push('status = @status')
      params.status = patch.status
    }

    if (assignments.length === 0) {
      return this.getTradeById(id)
    }

    assignments.push('updated_at = @updatedAt')
    params.updatedAt = Date.now()

    const result = this.db
      .prepare(
        `
          UPDATE trades
          SET ${assignments.join(', ')}
          WHERE id = @id
        `,
      )
      .run(params)

    if (result.changes === 0) {
      throw new Error(`Trade not found: ${id}`)
    }

    return this.getTradeById(id)
  }

  public deleteTrade(id: string): boolean {
    const result = this.db.prepare('DELETE FROM trades WHERE id = ?').run(id)
    return result.changes > 0
  }

  public createPortfolioSnapshot(input: CreatePortfolioSnapshotInput): PortfolioSnapshotRecord {
    const now = Date.now()
    this.db
      .prepare(
        `
          INSERT INTO portfolio_snapshots (
            id,
            captured_at,
            total_value,
            holdings_json,
            created_at
          ) VALUES (
            @id,
            @capturedAt,
            @totalValue,
            @holdingsJson,
            @createdAt
          )
        `,
      )
      .run({
        id: input.id,
        capturedAt: input.capturedAt,
        totalValue: input.totalValue,
        holdingsJson: input.holdingsJson,
        createdAt: now,
      })

    return this.getPortfolioSnapshotById(input.id)
  }

  public getPortfolioSnapshotById(id: string): PortfolioSnapshotRecord {
    const row = this.db
      .prepare(
        `
          SELECT
            id,
            captured_at AS capturedAt,
            total_value AS totalValue,
            holdings_json AS holdingsJson,
            created_at AS createdAt
          FROM portfolio_snapshots
          WHERE id = ?
        `,
      )
      .get(id) as PortfolioSnapshotRecord | undefined

    if (!row) {
      throw new Error(`Portfolio snapshot not found: ${id}`)
    }

    return row
  }

  public listPortfolioSnapshots(filters?: PortfolioSnapshotFilters): ReadonlyArray<PortfolioSnapshotRecord> {
    const whereClauses: string[] = []
    const params: Record<string, unknown> = {}

    if (filters?.fromTimestamp !== undefined) {
      whereClauses.push('captured_at >= @fromTimestamp')
      params.fromTimestamp = filters.fromTimestamp
    }

    if (filters?.toTimestamp !== undefined) {
      whereClauses.push('captured_at <= @toTimestamp')
      params.toTimestamp = filters.toTimestamp
    }

    params.limit = Math.max(1, Math.min(filters?.limit ?? 500, 5_000))
    params.offset = Math.max(0, filters?.offset ?? 0)

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''

    return this.db
      .prepare(
        `
          SELECT
            id,
            captured_at AS capturedAt,
            total_value AS totalValue,
            holdings_json AS holdingsJson,
            created_at AS createdAt
          FROM portfolio_snapshots
          ${whereSql}
          ORDER BY captured_at DESC
          LIMIT @limit
          OFFSET @offset
        `,
      )
      .all(params) as ReadonlyArray<PortfolioSnapshotRecord>
  }

  public deletePortfolioSnapshot(id: string): boolean {
    const result = this.db.prepare('DELETE FROM portfolio_snapshots WHERE id = ?').run(id)
    return result.changes > 0
  }

  public getAppliedMigrations(): ReadonlyArray<string> {
    const rows = this.db
      .prepare('SELECT name FROM schema_migrations ORDER BY applied_at ASC')
      .all() as ReadonlyArray<{ name: string }>
    return rows.map((row) => row.name)
  }

  public close(): void {
    this.db.close()
  }

  private applyMigrations(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `)

    const existing = new Set(
      (this.db.prepare('SELECT name FROM schema_migrations').all() as ReadonlyArray<{ name: string }>).map(
        (row) => row.name,
      ),
    )

    const applyMigration = this.db.transaction((migration: Migration) => {
      this.db.exec(migration.sql)
      this.db
        .prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (@name, @appliedAt)')
        .run({
          name: migration.name,
          appliedAt: Date.now(),
        })
    })

    for (const migration of MIGRATIONS) {
      if (!existing.has(migration.name)) {
        applyMigration(migration)
      }
    }
  }
}
