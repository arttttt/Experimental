import type { Candle, CandleRequest } from '@/domain/models/market/Candle';
import type { OhlcvClient } from '@/data/sources/api/OhlcvClient';
import { MarketDataClientError } from '@/data/sources/api/MarketDataClientError';
import { CandleCache } from '@/data/sources/memory/CandleCache';

export class OhlcvMarketDataService {
  private readonly primaryClient: OhlcvClient;
  private readonly fallbackClient: OhlcvClient;
  private readonly candleCache: CandleCache;

  public constructor(params: {
    primaryClient: OhlcvClient;
    fallbackClient: OhlcvClient;
    candleCache?: CandleCache;
  }) {
    this.primaryClient = params.primaryClient;
    this.fallbackClient = params.fallbackClient;
    this.candleCache = params.candleCache ?? new CandleCache();
  }

  public async getCandles(request: CandleRequest): Promise<Candle[]> {
    const cached = this.candleCache.get(request);
    if (cached && cached.length > 0) {
      return cached;
    }

    try {
      const primaryCandles = await this.primaryClient.getCandles(request);
      if (primaryCandles.length > 0) {
        this.candleCache.set(request, primaryCandles);
        return primaryCandles;
      }
      return this.fetchFromFallback(request, null);
    } catch (primaryError) {
      return this.fetchFromFallback(request, primaryError);
    }
  }

  private async fetchFromFallback(
    request: CandleRequest,
    primaryError: unknown,
  ): Promise<Candle[]> {
    try {
      const fallbackCandles = await this.fallbackClient.getCandles(request);
      if (fallbackCandles.length > 0) {
        this.candleCache.set(request, fallbackCandles);
      }
      return fallbackCandles;
    } catch (fallbackError) {
      if (primaryError === null) {
        throw fallbackError;
      }

      throw OhlcvMarketDataService.toCombinedError(primaryError, fallbackError);
    }
  }

  private static toCombinedError(
    primaryError: unknown,
    fallbackError: unknown,
  ): MarketDataClientError {
    const primaryMessage = OhlcvMarketDataService.errorText(primaryError);
    const fallbackMessage = OhlcvMarketDataService.errorText(fallbackError);

    return new MarketDataClientError(
      'market-data',
      `Primary source failed (${primaryMessage}); fallback failed (${fallbackMessage})`,
    );
  }

  private static errorText(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return 'unknown error';
  }
}
