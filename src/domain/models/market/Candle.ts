export type CandleInterval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

export type CandleCurrency = 'usd' | 'token';

export interface CandleRequest {
  address: string;
  interval: CandleInterval;
  fromUnixSec: number;
  toUnixSec: number;
  limit?: number;
  currency?: CandleCurrency;
}

export class Candle {
  public readonly openTimeUnixSec: number;
  public readonly open: number;
  public readonly high: number;
  public readonly low: number;
  public readonly close: number;
  public readonly volume: number;

  public constructor(params: {
    openTimeUnixSec: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }) {
    this.openTimeUnixSec = params.openTimeUnixSec;
    this.open = params.open;
    this.high = params.high;
    this.low = params.low;
    this.close = params.close;
    this.volume = params.volume;
  }
}
