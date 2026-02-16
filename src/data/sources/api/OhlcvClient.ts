import type { Candle, CandleRequest } from '@/domain/models/market/Candle';

export interface OhlcvClient {
  getCandles(request: CandleRequest): Promise<Candle[]>;
}
