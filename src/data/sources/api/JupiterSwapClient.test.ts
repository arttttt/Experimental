import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  JupiterSwapClient,
  type JupiterQuoteResponse,
} from '@/data/sources/api/JupiterSwapClient';
import { JupiterSwapClientError } from '@/data/sources/api/JupiterSwapClientError';
import { TokenMint, WalletAddress } from '@/domain/models/id';

const SOL_MINT = new TokenMint('So11111111111111111111111111111111111111112');
const USDC_MINT = new TokenMint('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const USER_ADDRESS = new WalletAddress('7fPjL6w7Dnk3a1JpN96CBvs1BgqsSVqSogn8CA9nVddq');

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

function makeQuoteResponse(overrides?: Partial<JupiterQuoteResponse>): JupiterQuoteResponse {
  return {
    inputMint: SOL_MINT.value,
    inAmount: '1000000000',
    outputMint: USDC_MINT.value,
    outAmount: '120000000',
    otherAmountThreshold: '119000000',
    swapMode: 'ExactIn',
    slippageBps: 50,
    priceImpactPct: '0.0023',
    routePlan: [
      {
        percent: 100,
        swapInfo: {
          ammKey: 'AmmKey1111111111111111111111111111111111',
          label: 'Raydium',
          inputMint: SOL_MINT.value,
          outputMint: USDC_MINT.value,
          inAmount: '1000000000',
          outAmount: '120000000',
          feeAmount: '1000',
          feeMint: USDC_MINT.value,
        },
      },
    ],
    contextSlot: 123,
    timeTaken: 0.22,
    ...overrides,
  };
}

describe('JupiterSwapClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requests quote and parses normalized quote response', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(makeQuoteResponse()),
    );

    const client = new JupiterSwapClient({ timeoutMs: 1000 });
    const quoteResponse = await client.getQuoteResponse({
      inputMint: SOL_MINT,
      outputMint: USDC_MINT,
      amountRaw: '1000000000',
      slippageBps: 50,
      restrictIntermediateTokens: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const url = new URL(fetchMock.mock.calls[0]?.[0] as string);
    expect(url.pathname).toBe('/swap/v1/quote');
    expect(url.searchParams.get('inputMint')).toBe(SOL_MINT.value);
    expect(url.searchParams.get('outputMint')).toBe(USDC_MINT.value);
    expect(url.searchParams.get('amount')).toBe('1000000000');
    expect(url.searchParams.get('slippageBps')).toBe('50');
    expect(url.searchParams.get('restrictIntermediateTokens')).toBe('true');
    expect(quoteResponse.routePlan).toHaveLength(1);
  });

  it('maps Jupiter quote response into domain SwapQuote', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(makeQuoteResponse()));

    const client = new JupiterSwapClient({ timeoutMs: 1000 });
    const quote = await client.getQuote({
      inputMint: SOL_MINT,
      outputMint: USDC_MINT,
      amountRaw: '1000000000',
      slippageBps: 50,
    });

    expect(quote.inputMint.equals(SOL_MINT)).toBe(true);
    expect(quote.outputMint.equals(USDC_MINT)).toBe(true);
    expect(quote.outAmountRaw).toBe('120000000');
    expect(quote.routePlan[0]?.ammLabel).toBe('Raydium');
    expect(quote.timeTakenMs).toBe(220);
  });

  it('builds swap transaction from quote response', async () => {
    const quoteResponse = makeQuoteResponse();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        swapTransaction: 'base64-transaction',
        lastValidBlockHeight: 999,
        prioritizationFeeLamports: 5000,
        computeUnitLimit: 1_400_000,
      }),
    );

    const client = new JupiterSwapClient({ timeoutMs: 1000 });
    const result = await client.buildSwapTransaction({
      quoteResponse,
      userPublicKey: USER_ADDRESS,
      prioritizationFeeLamports: 5000,
    });

    expect(result.swapTransactionBase64).toBe('base64-transaction');
    expect(result.lastValidBlockHeight).toBe(999);
    expect(result.prioritizationFeeLamports).toBe(5000);
    expect(result.computeUnitLimit).toBe(1_400_000);

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(typeof init?.body).toBe('string');
    const requestBody = JSON.parse(init?.body as string) as {
      quoteResponse: JupiterQuoteResponse;
      userPublicKey: string;
    };
    expect(requestBody.userPublicKey).toBe(USER_ADDRESS.value);
    expect(requestBody.quoteResponse.outputMint).toBe(USDC_MINT.value);
  });

  it('retries transient 500 errors and succeeds on later attempt', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ error: 'temporary issue' }, 500))
      .mockResolvedValueOnce(jsonResponse(makeQuoteResponse()));

    const client = new JupiterSwapClient({ timeoutMs: 1000 });
    const quoteResponse = await client.getQuoteResponse({
      inputMint: SOL_MINT,
      outputMint: USDC_MINT,
      amountRaw: '1000000000',
      slippageBps: 50,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(quoteResponse.outAmount).toBe('120000000');
  });

  it('throws validation error for invalid raw amount input', async () => {
    const client = new JupiterSwapClient();

    await expect(
      client.getQuoteResponse({
        inputMint: SOL_MINT,
        outputMint: USDC_MINT,
        amountRaw: '1.5',
        slippageBps: 50,
      }),
    ).rejects.toBeInstanceOf(JupiterSwapClientError);
  });
});
