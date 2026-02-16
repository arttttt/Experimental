export type CandleTimeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

export interface CandlePoint {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface FetchCandlesParams {
  address: string;
  timeframe: CandleTimeframe;
  signal?: AbortSignal;
}

const BIRDEYE_API_URL = 'https://public-api.birdeye.so/defi/ohlcv';
const DEFAULT_CANDLE_LIMIT = 300;

export class BirdeyeMarketDataClient {
  private static readonly timeframeToSeconds: Record<CandleTimeframe, number> = {
    '1m': 60,
    '5m': 300,
    '15m': 900,
    '1h': 3600,
    '4h': 14400,
    '1d': 86400,
  };

  public static async fetchCandles(params: FetchCandlesParams): Promise<CandlePoint[]> {
    const now = Math.floor(Date.now() / 1000);
    const intervalSeconds = BirdeyeMarketDataClient.timeframeToSeconds[params.timeframe];
    const start = now - intervalSeconds * DEFAULT_CANDLE_LIMIT;
    const searchParams = new URLSearchParams({
      address: params.address,
      type: params.timeframe,
      time_from: String(start),
      time_to: String(now),
    });
    const apiKey = import.meta.env.VITE_BIRDEYE_API_KEY;
    const headers: HeadersInit = {
      accept: 'application/json',
      'x-chain': 'solana',
    };

    if (typeof apiKey === 'string' && apiKey.trim().length > 0) {
      headers['X-API-KEY'] = apiKey;
    }

    const response = await fetch(`${BIRDEYE_API_URL}?${searchParams.toString()}`, {
      method: 'GET',
      headers,
      signal: params.signal,
    });

    if (!response.ok) {
      throw new Error(`Birdeye request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as unknown;
    return BirdeyeMarketDataClient.parseCandles(payload);
  }

  private static parseCandles(payload: unknown): CandlePoint[] {
    if (typeof payload !== 'object' || payload === null) {
      throw new Error('Birdeye response has invalid shape.');
    }

    const root = payload as Record<string, unknown>;
    const data = root.data;
    if (typeof data !== 'object' || data === null) {
      throw new Error('Birdeye response has no data object.');
    }

    const itemsValue = (data as Record<string, unknown>).items;
    if (!Array.isArray(itemsValue)) {
      throw new Error('Birdeye response has no candles.');
    }

    const candles = itemsValue
      .map((item) => BirdeyeMarketDataClient.parseCandle(item))
      .filter((item): item is CandlePoint => item !== null)
      .sort((left, right) => left.time - right.time);

    if (candles.length === 0) {
      throw new Error('Birdeye returned zero candles.');
    }

    return candles;
  }

  private static parseCandle(item: unknown): CandlePoint | null {
    if (typeof item !== 'object' || item === null) {
      return null;
    }

    const raw = item as Record<string, unknown>;
    const time = BirdeyeMarketDataClient.pickNumber(raw, ['unixTime', 'time']);
    const open = BirdeyeMarketDataClient.pickNumber(raw, ['o', 'open']);
    const high = BirdeyeMarketDataClient.pickNumber(raw, ['h', 'high']);
    const low = BirdeyeMarketDataClient.pickNumber(raw, ['l', 'low']);
    const close = BirdeyeMarketDataClient.pickNumber(raw, ['c', 'close']);
    const volume = BirdeyeMarketDataClient.pickNumber(raw, ['v', 'volume']) ?? 0;

    if (
      typeof time !== 'number' ||
      typeof open !== 'number' ||
      typeof high !== 'number' ||
      typeof low !== 'number' ||
      typeof close !== 'number'
    ) {
      return null;
    }

    return {
      time,
      open,
      high,
      low,
      close,
      volume,
    };
  }

  private static pickNumber(source: Record<string, unknown>, keys: string[]): number | null {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }

      if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }

    return null;
  }
}
