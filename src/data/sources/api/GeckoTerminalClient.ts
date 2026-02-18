import { CandleNormalizer } from '@/data/sources/api/CandleNormalizer';
import { MarketDataClientError } from '@/data/sources/api/MarketDataClientError';
import type { OhlcvClient } from '@/data/sources/api/OhlcvClient';
import type { Candle, CandleInterval, CandleRequest } from '@/domain/models/market/Candle';

interface GeckoTerminalPoolsResponse {
  data?: unknown[];
}

interface GeckoTerminalOhlcvResponse {
  data?: {
    attributes?: {
      ohlcv_list?: unknown[];
    };
  };
}

type IntervalMapping = {
  period: 'minute' | 'hour' | 'day';
  aggregate: number;
};

const INTERVAL_MAPPING: Record<CandleInterval, IntervalMapping> = {
  '1m': { period: 'minute', aggregate: 1 },
  '5m': { period: 'minute', aggregate: 5 },
  '15m': { period: 'minute', aggregate: 15 },
  '1h': { period: 'hour', aggregate: 1 },
  '4h': { period: 'hour', aggregate: 4 },
  '1d': { period: 'day', aggregate: 1 },
};

const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 600;

export class GeckoTerminalClient implements OhlcvClient {
  private readonly baseUrl: string;
  private readonly chainId: string;
  private readonly timeoutMs: number;
  private readonly resolvedPoolByAddress = new Map<string, string>();

  public constructor(params?: { baseUrl?: string; chainId?: string; timeoutMs?: number }) {
    this.baseUrl = params?.baseUrl ?? 'https://api.geckoterminal.com/api/v2';
    this.chainId = params?.chainId ?? 'solana';
    this.timeoutMs = params?.timeoutMs ?? 8_000;
  }

  public async getCandles(request: CandleRequest): Promise<Candle[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const mappedAddress = this.resolvedPoolByAddress.get(request.address);
      const primaryAddress = mappedAddress ?? request.address;

      try {
        return await this.fetchCandlesByPool(primaryAddress, request, controller.signal);
      } catch (error) {
        if (!(error instanceof MarketDataClientError) || error.status !== 404) {
          throw error;
        }
      }

      const resolvedPoolAddress = await this.resolvePoolAddress(request.address, controller.signal);
      if (!resolvedPoolAddress || resolvedPoolAddress === primaryAddress) {
        throw new MarketDataClientError('geckoterminal', 'Pool not found for address');
      }

      this.resolvedPoolByAddress.set(request.address, resolvedPoolAddress);
      return this.fetchCandlesByPool(resolvedPoolAddress, request, controller.signal);
    } catch (error) {
      if (error instanceof MarketDataClientError) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new MarketDataClientError('geckoterminal', 'Request timed out');
      }

      throw new MarketDataClientError(
        'geckoterminal',
        error instanceof Error ? error.message : 'Unknown GeckoTerminal error',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchCandlesByPool(
    poolAddress: string,
    request: CandleRequest,
    signal: AbortSignal,
  ): Promise<Candle[]> {
    const mapping = INTERVAL_MAPPING[request.interval];
    const query = new URLSearchParams({
      aggregate: String(mapping.aggregate),
      limit: String(request.limit ?? 300),
    });

    const url =
      `${this.baseUrl}/networks/${this.chainId}/pools/${encodeURIComponent(poolAddress)}/ohlcv/${mapping.period}` +
      `?${query.toString()}`;

    const payload = await this.fetchJsonWithRetry<GeckoTerminalOhlcvResponse>(url, signal);
    const rawItems = payload.data?.attributes?.ohlcv_list;

    if (!Array.isArray(rawItems)) {
      return [];
    }

    return CandleNormalizer.normalize(rawItems).filter(
      (candle) =>
        candle.openTimeUnixSec >= request.fromUnixSec &&
        candle.openTimeUnixSec <= request.toUnixSec,
    );
  }

  private async resolvePoolAddress(address: string, signal: AbortSignal): Promise<string | null> {
    const url = `${this.baseUrl}/networks/${this.chainId}/tokens/${encodeURIComponent(address)}/pools`;
    const payload = await this.fetchJsonWithRetry<GeckoTerminalPoolsResponse>(url, signal);

    if (!Array.isArray(payload.data) || payload.data.length === 0) {
      return null;
    }

    for (const item of payload.data) {
      const parsed = GeckoTerminalClient.extractPoolAddress(item);
      if (parsed) {
        return parsed;
      }
    }

    return null;
  }

  private async fetchJsonWithRetry<T>(url: string, signal: AbortSignal): Promise<T> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
        },
        signal,
      });

      if (response.ok) {
        return (await response.json()) as T;
      }

      if (response.status === 429 && attempt < MAX_RETRIES) {
        await GeckoTerminalClient.sleep(
          GeckoTerminalClient.retryDelayMs(response, attempt),
          signal,
        );
        continue;
      }

      throw new MarketDataClientError('geckoterminal', `HTTP ${response.status}`, response.status);
    }

    throw new MarketDataClientError('geckoterminal', 'Rate limit retries exhausted', 429);
  }

  private static retryDelayMs(response: Response, attempt: number): number {
    const retryAfterHeader = response.headers.get('retry-after');
    if (retryAfterHeader) {
      const retryAfterSeconds = Number.parseInt(retryAfterHeader, 10);
      if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
        return retryAfterSeconds * 1000;
      }
    }

    return RETRY_BASE_DELAY_MS * 2 ** attempt;
  }

  private static sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);

      const onAbort = () => {
        clearTimeout(timer);
        const error = new Error('Aborted');
        error.name = 'AbortError';
        reject(error);
      };

      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private static extractPoolAddress(item: unknown): string | null {
    if (typeof item !== 'object' || item === null) {
      return null;
    }

    const record = item as { id?: unknown; attributes?: { address?: unknown } };
    if (typeof record.attributes?.address === 'string' && record.attributes.address.length > 0) {
      return record.attributes.address;
    }

    if (typeof record.id === 'string' && record.id.length > 0) {
      const underscoreIndex = record.id.lastIndexOf('_');
      if (underscoreIndex >= 0 && underscoreIndex + 1 < record.id.length) {
        return record.id.slice(underscoreIndex + 1);
      }

      return record.id;
    }

    return null;
  }
}
