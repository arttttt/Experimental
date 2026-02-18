import { afterEach, describe, expect, it, vi } from 'vitest';

import { GeckoTerminalClient } from '@/data/sources/api/GeckoTerminalClient';

const REQUEST = {
  address: 'pool-address',
  interval: '15m' as const,
  fromUnixSec: 100,
  toUnixSec: 200,
  limit: 2,
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

describe('GeckoTerminalClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches OHLCV candles for a pool and maps tuple payload', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        data: {
          attributes: {
            ohlcv_list: [
              [100, 10, 11, 9, 10.5, 200],
              [220, 11, 12, 10, 11.5, 300],
            ],
          },
        },
      }),
    );

    const client = new GeckoTerminalClient({ timeoutMs: 1000 });
    const candles = await client.getCandles(REQUEST);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.geckoterminal.com/api/v2/networks/solana/pools/pool-address/ohlcv/minute?aggregate=15&limit=2',
    );
    expect(candles).toEqual([
      {
        openTimeUnixSec: 100,
        open: 10,
        high: 11,
        low: 9,
        close: 10.5,
        volume: 200,
      },
    ]);
  });

  it('resolves token pool address when direct pool lookup returns 404', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({}, 404))
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: 'solana_resolved-pool-address' }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            attributes: {
              ohlcv_list: [[150, 1, 2, 0.5, 1.5, 50]],
            },
          },
        }),
      );

    const client = new GeckoTerminalClient({ timeoutMs: 1000 });
    const candles = await client.getCandles({
      ...REQUEST,
      address: 'token-mint-address',
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/pools/token-mint-address/ohlcv/minute');
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/tokens/token-mint-address/pools');
    expect(fetchMock.mock.calls[2]?.[0]).toContain('/pools/resolved-pool-address/ohlcv/minute');
    expect(candles).toHaveLength(1);
  });
});
