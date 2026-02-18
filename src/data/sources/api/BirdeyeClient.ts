import type { Candle, CandleRequest } from '@/domain/models/market/Candle';
import { CandleNormalizer } from '@/data/sources/api/CandleNormalizer';
import { MarketDataClientError } from '@/data/sources/api/MarketDataClientError';
import type { OhlcvClient } from '@/data/sources/api/OhlcvClient';

interface BirdeyeResponse {
  success?: boolean;
  data?: {
    items?: unknown[];
    candles?: unknown[];
  } | unknown[];
  message?: string;
}

export class BirdeyeClient implements OhlcvClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;

  public constructor(params?: { baseUrl?: string; apiKey?: string; timeoutMs?: number }) {
    this.baseUrl = params?.baseUrl ?? 'https://public-api.birdeye.so';
    this.apiKey = params?.apiKey;
    this.timeoutMs = params?.timeoutMs ?? 8_000;
  }

  public async getCandles(request: CandleRequest): Promise<Candle[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const query = new URLSearchParams({
        address: request.fallbackAddress ?? request.address,
        type: request.interval,
        time_from: String(request.fromUnixSec),
        time_to: String(request.toUnixSec),
        currency: request.currency ?? 'usd',
      });

      if (request.limit) {
        query.set('limit', String(request.limit));
      }

      const response = await fetch(`${this.baseUrl}/defi/ohlcv?${query.toString()}`, {
        headers: {
          Accept: 'application/json',
          'x-chain': 'solana',
          ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}),
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new MarketDataClientError('birdeye', `HTTP ${response.status}`, response.status);
      }

      const payload = (await response.json()) as BirdeyeResponse;
      if (payload.success === false) {
        throw new MarketDataClientError(
          'birdeye',
          payload.message ?? 'Birdeye returned unsuccessful response',
        );
      }

      const rawItems = BirdeyeClient.extractItems(payload);
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
        throw new MarketDataClientError('birdeye', 'Request timed out');
      }

      throw new MarketDataClientError(
        'birdeye',
        error instanceof Error ? error.message : 'Unknown Birdeye error',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private static extractItems(payload: BirdeyeResponse): unknown[] {
    if (Array.isArray(payload.data)) {
      return payload.data;
    }

    if (payload.data && Array.isArray(payload.data.items)) {
      return payload.data.items;
    }

    if (payload.data && Array.isArray(payload.data.candles)) {
      return payload.data.candles;
    }

    return [];
  }
}
