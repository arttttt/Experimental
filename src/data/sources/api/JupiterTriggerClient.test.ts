import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  JupiterTriggerClient,
  JupiterTriggerClientError,
} from '@/data/sources/api/JupiterTriggerClient';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

describe('JupiterTriggerClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates order and supports tx field in response', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        tx: 'base64-transaction',
        requestId: 'req-1',
      }),
    );

    const client = new JupiterTriggerClient({ timeoutMs: 1000 });
    const result = await client.createOrder({
      inputMint: 'So11111111111111111111111111111111111111112',
      outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      maker: '7QfWf9R8UVh4iQfVq8M8L6X6KQ2DmbVnJx8aS3n8zXjW',
      payer: '7QfWf9R8UVh4iQfVq8M8L6X6KQ2DmbVnJx8aS3n8zXjW',
      params: {
        makingAmount: '1000000',
        takingAmount: '300000',
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://lite-api.jup.ag/trigger/v1/createOrder');
    expect(result).toEqual({
      transaction: 'base64-transaction',
      requestId: 'req-1',
    });
  });

  it('throws JupiterTriggerClientError when cancelOrder returns API error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(
        {
          error: 'no matching orders found',
          code: 400,
          requestId: 'req-2',
        },
        400,
      ),
    );

    const client = new JupiterTriggerClient({ timeoutMs: 1000 });

    await expect(
      client.cancelOrder({
        maker: '7QfWf9R8UVh4iQfVq8M8L6X6KQ2DmbVnJx8aS3n8zXjW',
        order: '3g2jF8txqXPp6GUStwtXMrWydeYWxU4qoBA8UDLoTnK7',
      }),
    ).rejects.toMatchObject({
      message: 'Jupiter Trigger API HTTP 400',
      status: 400,
      code: 400,
      requestId: 'req-2',
    } satisfies Partial<JupiterTriggerClientError>);
  });

  it('reads trigger orders from nested data payload', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        data: {
          orders: [{ order: 'order-1' }, { order: 'order-2' }],
          hasMoreData: true,
        },
      }),
    );

    const client = new JupiterTriggerClient({ timeoutMs: 1000 });
    const result = await client.getTriggerOrders({
      user: '7QfWf9R8UVh4iQfVq8M8L6X6KQ2DmbVnJx8aS3n8zXjW',
      orderStatus: 'active',
      page: 2,
    });

    expect(result).toEqual({
      orders: [{ order: 'order-1' }, { order: 'order-2' }],
      hasMoreData: true,
    });
  });

  it('fails fast for invalid page argument', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    const client = new JupiterTriggerClient({ timeoutMs: 1000 });

    await expect(
      client.getTriggerOrders({
        user: '7QfWf9R8UVh4iQfVq8M8L6X6KQ2DmbVnJx8aS3n8zXjW',
        page: 0,
      }),
    ).rejects.toThrow('page must be a positive integer');

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
