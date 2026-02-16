import type { Candle, CandleRequest } from '@/domain/models/market/Candle';

interface CandleCacheEntry {
  expiresAtMs: number;
  candles: Candle[];
}

export class CandleCache {
  private readonly entries = new Map<string, CandleCacheEntry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  public constructor(params?: { ttlMs?: number; maxEntries?: number }) {
    this.ttlMs = params?.ttlMs ?? 30_000;
    this.maxEntries = params?.maxEntries ?? 256;
  }

  public get(request: CandleRequest): Candle[] | null {
    const key = CandleCache.createKey(request);
    const cached = this.entries.get(key);

    if (!cached) {
      return null;
    }

    if (Date.now() > cached.expiresAtMs) {
      this.entries.delete(key);
      return null;
    }

    return [...cached.candles];
  }

  public set(request: CandleRequest, candles: Candle[]): void {
    this.evictExpired();

    if (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey) {
        this.entries.delete(oldestKey);
      }
    }

    this.entries.set(CandleCache.createKey(request), {
      expiresAtMs: Date.now() + this.ttlMs,
      candles: [...candles],
    });
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries.entries()) {
      if (entry.expiresAtMs <= now) {
        this.entries.delete(key);
      }
    }
  }

  private static createKey(request: CandleRequest): string {
    const limit = request.limit ?? 0;
    const currency = request.currency ?? 'usd';
    return [
      request.address,
      request.interval,
      request.fromUnixSec,
      request.toUnixSec,
      limit,
      currency,
    ].join('|');
  }
}
