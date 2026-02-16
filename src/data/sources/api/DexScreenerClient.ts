import type { Candle, CandleRequest } from '@/domain/models/market/Candle';
import { CandleNormalizer } from '@/data/sources/api/CandleNormalizer';
import { MarketDataClientError } from '@/data/sources/api/MarketDataClientError';
import type { OhlcvClient } from '@/data/sources/api/OhlcvClient';

interface DexScreenerResponse {
  bars?: unknown[];
  candles?: unknown[];
  data?: {
    bars?: unknown[];
    candles?: unknown[];
  };
}

export class DexScreenerClient implements OhlcvClient {
  private readonly baseUrl: string;
  private readonly chainId: string;
  private readonly timeoutMs: number;

  public constructor(params?: { baseUrl?: string; chainId?: string; timeoutMs?: number }) {
    this.baseUrl = params?.baseUrl ?? 'https://io.dexscreener.com';
    this.chainId = params?.chainId ?? 'solana';
    this.timeoutMs = params?.timeoutMs ?? 8_000;
  }

  public async getCandles(request: CandleRequest): Promise<Candle[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const query = new URLSearchParams({
        from: String(request.fromUnixSec),
        to: String(request.toUnixSec),
        resolution: request.interval,
      });

      if (request.limit) {
        query.set('limit', String(request.limit));
      }

      const url =
        `${this.baseUrl}/dex/chart/amm/v2/bars/${this.chainId}/${request.address}` +
        `?${query.toString()}`;

      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new MarketDataClientError(
          'dexscreener',
          `HTTP ${response.status}`,
          response.status,
        );
      }

      const payload = (await response.json()) as DexScreenerResponse;
      const rawItems = DexScreenerClient.extractItems(payload);
      return CandleNormalizer.normalize(rawItems).filter(
        (candle) =>
          candle.openTimeUnixSec >= request.fromUnixSec &&
          candle.openTimeUnixSec <= request.toUnixSec,
      );
    } catch (error) {
      if (error instanceof MarketDataClientError) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new MarketDataClientError('dexscreener', 'Request timed out');
      }

      throw new MarketDataClientError(
        'dexscreener',
        error instanceof Error ? error.message : 'Unknown DexScreener error',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private static extractItems(payload: DexScreenerResponse): unknown[] {
    if (Array.isArray(payload.bars)) {
      return payload.bars;
    }

    if (Array.isArray(payload.candles)) {
      return payload.candles;
    }

    if (payload.data && Array.isArray(payload.data.bars)) {
      return payload.data.bars;
    }

    if (payload.data && Array.isArray(payload.data.candles)) {
      return payload.data.candles;
    }

    return [];
  }
}
