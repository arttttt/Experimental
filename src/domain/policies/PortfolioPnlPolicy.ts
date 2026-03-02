export type PnlPeriod = '24h' | '7d' | '30d' | 'all';

export interface PnlTrade {
  pair: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  fee?: number;
  timestamp: number;
  status?: string;
}

export interface PnlPositionInput {
  symbol: string;
  quantity: number;
  marketPrice: number;
}

export interface AssetPnlBreakdown {
  symbol: string;
  quantity: number;
  marketPrice: number;
  realized: number;
  unrealized: number;
  total: number;
}

export interface PeriodPnlBreakdown {
  realized: number;
  unrealized: number;
  total: number;
  byAsset: readonly AssetPnlBreakdown[];
}

export interface PortfolioPnlSnapshot {
  byPeriod: Record<PnlPeriod, PeriodPnlBreakdown>;
}

export interface CalculatePortfolioPnlInput {
  trades: readonly PnlTrade[];
  positions: readonly PnlPositionInput[];
  nowTimestamp?: number;
}

interface PnlLot {
  quantity: number;
  unitCost: number;
  openedAt: number;
}

interface AssetState {
  symbol: string;
  marketPrice: number;
  quantity: number;
  hasExplicitPosition: boolean;
  openLots: PnlLot[];
  realizedByPeriod: Record<PnlPeriod, number>;
  unrealizedByPeriod: Record<PnlPeriod, number>;
}

const PERIOD_ORDER: readonly PnlPeriod[] = ['24h', '7d', '30d', 'all'];

const PERIOD_WINDOWS_MS: Readonly<Record<Exclude<PnlPeriod, 'all'>, number>> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

const ZERO_BY_PERIOD: Record<PnlPeriod, number> = {
  '24h': 0,
  '7d': 0,
  '30d': 0,
  all: 0,
};

function createZeroByPeriod(): Record<PnlPeriod, number> {
  return { ...ZERO_BY_PERIOD };
}

function toBaseAssetSymbol(pair: string): string | null {
  const [base] = pair.split('/');
  const normalized = base?.trim().toUpperCase();
  return normalized && normalized.length > 0 ? normalized : null;
}

function safeNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return value;
}

function periodStartTimestamp(period: PnlPeriod, nowTimestamp: number): number {
  if (period === 'all') {
    return Number.NEGATIVE_INFINITY;
  }

  return nowTimestamp - PERIOD_WINDOWS_MS[period];
}

export class PortfolioPnlPolicy {
  public static calculate(input: CalculatePortfolioPnlInput): PortfolioPnlSnapshot {
    const nowTimestamp = input.nowTimestamp ?? Date.now();
    const periodStartByPeriod: Record<PnlPeriod, number> = {
      '24h': periodStartTimestamp('24h', nowTimestamp),
      '7d': periodStartTimestamp('7d', nowTimestamp),
      '30d': periodStartTimestamp('30d', nowTimestamp),
      all: periodStartTimestamp('all', nowTimestamp),
    };

    const assets = new Map<string, AssetState>();
    const marketPriceFallbackBySymbol = new Map<string, number>();

    for (const position of input.positions) {
      const symbol = position.symbol.trim().toUpperCase();
      if (!symbol) {
        continue;
      }

      const quantity = safeNumber(position.quantity) ?? 0;
      const marketPrice = safeNumber(position.marketPrice) ?? 0;
      assets.set(symbol, {
        symbol,
        quantity: Math.max(0, quantity),
        marketPrice: Math.max(0, marketPrice),
        hasExplicitPosition: true,
        openLots: [],
        realizedByPeriod: createZeroByPeriod(),
        unrealizedByPeriod: createZeroByPeriod(),
      });
      marketPriceFallbackBySymbol.set(symbol, Math.max(0, marketPrice));
    }

    const trades = [...input.trades]
      .filter((trade) => trade.status === undefined || trade.status === 'filled')
      .sort((left, right) => left.timestamp - right.timestamp);

    for (const trade of trades) {
      const symbol = toBaseAssetSymbol(trade.pair);
      const quantity = safeNumber(trade.quantity);
      const price = safeNumber(trade.price);
      const timestamp = safeNumber(trade.timestamp);
      const fee = Math.max(0, safeNumber(trade.fee) ?? 0);

      if (!symbol || !quantity || !price || !timestamp || quantity <= 0 || price < 0) {
        continue;
      }

      let state = assets.get(symbol);
      if (!state) {
        state = {
          symbol,
          quantity: 0,
          marketPrice: marketPriceFallbackBySymbol.get(symbol) ?? 0,
          hasExplicitPosition: false,
          openLots: [],
          realizedByPeriod: createZeroByPeriod(),
          unrealizedByPeriod: createZeroByPeriod(),
        };
        assets.set(symbol, state);
      }

      if (trade.side === 'buy') {
        const unitCost = price + fee / quantity;
        state.openLots.push({ quantity, unitCost, openedAt: timestamp });
        if (state.marketPrice <= 0) {
          state.marketPrice = price;
        }
        continue;
      }

      let remaining = quantity;
      const netSellUnitPrice = Math.max(0, price - fee / quantity);

      while (remaining > 0) {
        const nextLot = state.openLots[0];
        if (!nextLot) {
          break;
        }

        const matchedQuantity = Math.min(remaining, nextLot.quantity);
        const realizedDelta = matchedQuantity * (netSellUnitPrice - nextLot.unitCost);

        for (const period of PERIOD_ORDER) {
          if (timestamp >= periodStartByPeriod[period]) {
            state.realizedByPeriod[period] += realizedDelta;
          }
        }

        nextLot.quantity -= matchedQuantity;
        remaining -= matchedQuantity;

        if (nextLot.quantity <= Number.EPSILON) {
          state.openLots.shift();
        }
      }
    }

    for (const state of assets.values()) {
      let openQuantity = state.openLots.reduce((sum, lot) => sum + lot.quantity, 0);

      if (!state.hasExplicitPosition) {
        state.quantity = openQuantity;
      }

      if (state.quantity > openQuantity) {
        state.openLots.push({
          quantity: state.quantity - openQuantity,
          unitCost: state.marketPrice,
          openedAt: nowTimestamp,
        });
        openQuantity = state.quantity;
      }

      if (state.quantity < openQuantity) {
        let excess = openQuantity - state.quantity;
        for (let index = state.openLots.length - 1; index >= 0 && excess > 0; index -= 1) {
          const lot = state.openLots[index];
          const reduced = Math.min(excess, lot.quantity);
          lot.quantity -= reduced;
          excess -= reduced;

          if (lot.quantity <= Number.EPSILON) {
            state.openLots.splice(index, 1);
          }
        }
      }

      for (const lot of state.openLots) {
        const unrealizedDelta = lot.quantity * (state.marketPrice - lot.unitCost);
        for (const period of PERIOD_ORDER) {
          if (lot.openedAt >= periodStartByPeriod[period]) {
            state.unrealizedByPeriod[period] += unrealizedDelta;
          }
        }
      }
    }

    const byPeriod: Record<PnlPeriod, PeriodPnlBreakdown> = {
      '24h': { realized: 0, unrealized: 0, total: 0, byAsset: [] },
      '7d': { realized: 0, unrealized: 0, total: 0, byAsset: [] },
      '30d': { realized: 0, unrealized: 0, total: 0, byAsset: [] },
      all: { realized: 0, unrealized: 0, total: 0, byAsset: [] },
    };

    for (const period of PERIOD_ORDER) {
      const byAsset = [...assets.values()]
        .map((asset) => {
          const realized = asset.realizedByPeriod[period];
          const unrealized = asset.unrealizedByPeriod[period];
          const total = realized + unrealized;
          return {
            symbol: asset.symbol,
            quantity: asset.quantity,
            marketPrice: asset.marketPrice,
            realized,
            unrealized,
            total,
          } satisfies AssetPnlBreakdown;
        })
        .filter((asset) => asset.quantity > 0 || asset.realized !== 0 || asset.unrealized !== 0)
        .sort((left, right) => Math.abs(right.total) - Math.abs(left.total));

      const realized = byAsset.reduce((sum, asset) => sum + asset.realized, 0);
      const unrealized = byAsset.reduce((sum, asset) => sum + asset.unrealized, 0);

      byPeriod[period] = {
        realized,
        unrealized,
        total: realized + unrealized,
        byAsset,
      };
    }

    return { byPeriod };
  }
}
