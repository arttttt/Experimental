import { Candle } from '@/domain/models/market/Candle';

type LooseCandleObject = {
  [key: string]: unknown;
};

export class CandleNormalizer {
  public static normalize(items: unknown[]): Candle[] {
    const candles: Candle[] = [];

    for (const item of items) {
      const fromObject = CandleNormalizer.fromObject(item);
      if (fromObject) {
        candles.push(fromObject);
      }
    }

    candles.sort((a, b) => a.openTimeUnixSec - b.openTimeUnixSec);
    return candles;
  }

  private static fromObject(item: unknown): Candle | null {
    if (Array.isArray(item)) {
      return CandleNormalizer.fromTuple(item);
    }

    if (typeof item !== 'object' || item === null) {
      return null;
    }

    const obj = item as LooseCandleObject;
    const openTimeUnixSec = CandleNormalizer.asNumber(
      obj.unixTime ?? obj.time ?? obj.t ?? obj.openTime,
    );
    const open = CandleNormalizer.asNumber(obj.o ?? obj.open ?? obj.openPrice);
    const high = CandleNormalizer.asNumber(obj.h ?? obj.high ?? obj.highPrice);
    const low = CandleNormalizer.asNumber(obj.l ?? obj.low ?? obj.lowPrice);
    const close = CandleNormalizer.asNumber(obj.c ?? obj.close ?? obj.closePrice);
    const volume = CandleNormalizer.asNumber(obj.v ?? obj.volume ?? obj.baseVolume);

    if (
      openTimeUnixSec === null ||
      open === null ||
      high === null ||
      low === null ||
      close === null ||
      volume === null
    ) {
      return null;
    }

    return new Candle({
      openTimeUnixSec: CandleNormalizer.toUnixSec(openTimeUnixSec),
      open,
      high,
      low,
      close,
      volume,
    });
  }

  private static asNumber(value: unknown): number | null {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }

    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  }

  private static fromTuple(item: unknown[]): Candle | null {
    if (item.length < 6) {
      return null;
    }

    const openTime = CandleNormalizer.asNumber(item[0]);
    const open = CandleNormalizer.asNumber(item[1]);
    const high = CandleNormalizer.asNumber(item[2]);
    const low = CandleNormalizer.asNumber(item[3]);
    const close = CandleNormalizer.asNumber(item[4]);
    const volume = CandleNormalizer.asNumber(item[5]);

    if (
      openTime === null ||
      open === null ||
      high === null ||
      low === null ||
      close === null ||
      volume === null
    ) {
      return null;
    }

    return new Candle({
      openTimeUnixSec: CandleNormalizer.toUnixSec(openTime),
      open,
      high,
      low,
      close,
      volume,
    });
  }

  private static toUnixSec(value: number): number {
    if (value > 9_999_999_999) {
      return Math.floor(value / 1000);
    }

    return Math.floor(value);
  }
}
