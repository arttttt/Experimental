import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BalanceService } from '@/data/sources/api/BalanceClient';
import { TokenMint, WalletAddress } from '@/domain/models/id';
import { TOKENS } from '@/infrastructure/shared/config/tokens';

const WALLET = new WalletAddress('6QWeT6FpJrm8AF1btu6WH2k2Xhq2jRPjZ8M2Wspxt3r9');
const USDC_MINT = new TokenMint('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

function mockJsonResponse(payload: unknown): Response {
  return {
    ok: true,
    json: async () => payload,
  } as Response;
}

describe('BalanceService', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('converts lamports to SOL for getSolBalance', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockJsonResponse({
        result: {
          value: 1_000_000_000,
        },
      }),
    );

    const service = new BalanceService({
      retries: 0,
    });

    await expect(service.getSolBalance(WALLET)).resolves.toBe(1);
  });

  it('parses SPL token amount from jsonParsed response', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockJsonResponse({
        result: {
          value: [
            {
              account: {
                data: {
                  parsed: {
                    info: {
                      tokenAmount: {
                        amount: '1234500',
                      },
                    },
                  },
                },
              },
            },
          ],
        },
      }),
    );

    const service = new BalanceService({
      retries: 0,
    });

    await expect(service.getTokenBalance(WALLET, USDC_MINT, 6)).resolves.toBe(1.2345);
  });

  it('returns zero when token account is missing', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockJsonResponse({
        result: {
          value: [],
        },
      }),
    );

    const service = new BalanceService({
      retries: 0,
    });

    await expect(service.getTokenBalance(WALLET, USDC_MINT, 6)).resolves.toBe(0);
  });

  it('groups getAllBalances into one batch HTTP request', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockJsonResponse([
        {
          id: 1,
          result: {
            value: 2_000_000_000,
          },
        },
        {
          id: 2,
          result: {
            value: [
              {
                account: {
                  data: {
                    parsed: {
                      info: {
                        tokenAmount: {
                          amount: '1000000',
                        },
                      },
                    },
                  },
                },
              },
            ],
          },
        },
        {
          id: 3,
          result: {
            value: [],
          },
        },
      ]),
    );

    const service = new BalanceService({
      retries: 0,
    });

    const result = await service.getAllBalances(WALLET, [...TOKENS]);
    const fetchMock = vi.mocked(fetch);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Array<{
      method: string;
    }>;
    expect(Array.isArray(requestBody)).toBe(true);
    expect(requestBody).toHaveLength(3);
    expect(requestBody[0].method).toBe('getBalance');
    expect(requestBody[1].method).toBe('getTokenAccountsByOwner');
    expect(requestBody[2].method).toBe('getTokenAccountsByOwner');

    expect(result.get(TOKENS[0].mint.value)?.balance).toBe(2);
    expect(result.get(TOKENS[1].mint.value)?.balance).toBe(1);
    expect(result.get(TOKENS[2].mint.value)?.balance).toBe(0);
  });

  it('uses cache within ttl and refreshes after ttl', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        mockJsonResponse({
          result: {
            value: 1_000_000_000,
          },
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          result: {
            value: 2_000_000_000,
          },
        }),
      );

    const service = new BalanceService({
      retries: 0,
      cacheTtlMs: 50,
    });

    await expect(service.getSolBalance(WALLET)).resolves.toBe(1);
    await expect(service.getSolBalance(WALLET)).resolves.toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 60);
    });

    await expect(service.getSolBalance(WALLET)).resolves.toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('invalidate clears cached balances for wallet', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        mockJsonResponse({
          result: {
            value: 1_000_000_000,
          },
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          result: {
            value: 3_000_000_000,
          },
        }),
      );

    const service = new BalanceService({
      retries: 0,
    });

    await expect(service.getSolBalance(WALLET)).resolves.toBe(1);
    service.invalidate(WALLET);
    await expect(service.getSolBalance(WALLET)).resolves.toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
