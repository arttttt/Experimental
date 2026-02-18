import { JupiterSwapClientError } from '@/data/sources/api/JupiterSwapClientError';
import { TokenMint, WalletAddress } from '@/domain/models/id';
import { type SwapRouteLeg, SwapQuote } from '@/domain/models/quote';
import { SlippagePolicy } from '@/domain/policies';
import { Retry } from '@/infrastructure/shared/resilience';

export type JupiterSwapMode = 'ExactIn' | 'ExactOut';

export type JupiterQuoteRequest = Readonly<{
  inputMint: TokenMint;
  outputMint: TokenMint;
  amountRaw: string;
  slippageBps: number;
  swapMode?: JupiterSwapMode;
  onlyDirectRoutes?: boolean;
  restrictIntermediateTokens?: boolean;
  asLegacyTransaction?: boolean;
}>;

export type JupiterQuoteResponse = Readonly<{
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: JupiterSwapMode;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: readonly JupiterRoutePlanItem[];
  contextSlot?: number;
  timeTaken?: number;
}> &
  Readonly<Record<string, unknown>>;

export type JupiterRoutePlanItem = Readonly<{
  percent?: number;
  bps?: number;
  swapInfo: {
    ammKey?: string;
    label?: string;
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    feeAmount: string;
    feeMint: string;
  };
}>;

export type JupiterSwapBuildRequest = Readonly<{
  userPublicKey: WalletAddress;
  quoteResponse: JupiterQuoteResponse;
  wrapAndUnwrapSol?: boolean;
  dynamicComputeUnitLimit?: boolean;
  prioritizationFeeLamports?: number;
}>;

export type JupiterSwapBuildResponse = Readonly<{
  swapTransactionBase64: string;
  lastValidBlockHeight?: number;
  prioritizationFeeLamports?: number;
  computeUnitLimit?: number;
}>;

export type JupiterSwapClientParams = Readonly<{
  baseUrl?: string;
  timeoutMs?: number;
  apiKey?: string;
}>;

interface JupiterRawQuoteResponse {
  inputMint?: unknown;
  inAmount?: unknown;
  outputMint?: unknown;
  outAmount?: unknown;
  otherAmountThreshold?: unknown;
  swapMode?: unknown;
  slippageBps?: unknown;
  priceImpactPct?: unknown;
  routePlan?: unknown;
  contextSlot?: unknown;
  timeTaken?: unknown;
}

interface JupiterRawSwapBuildResponse {
  swapTransaction?: unknown;
  lastValidBlockHeight?: unknown;
  prioritizationFeeLamports?: unknown;
  computeUnitLimit?: unknown;
}

export class JupiterSwapClient {
  private static readonly DEFAULT_BASE_URL = 'https://lite-api.jup.ag/swap/v1';
  private static readonly MAX_RETRIES = 2;

  private readonly quoteUrl: string;
  private readonly swapUrl: string;
  private readonly timeoutMs: number;
  private readonly apiKey?: string;

  public constructor(params?: JupiterSwapClientParams) {
    const baseUrl = params?.baseUrl ?? JupiterSwapClient.DEFAULT_BASE_URL;
    this.quoteUrl = `${baseUrl}/quote`;
    this.swapUrl = `${baseUrl}/swap`;
    this.timeoutMs = params?.timeoutMs ?? 8_000;
    this.apiKey = params?.apiKey;
  }

  public async getQuote(request: JupiterQuoteRequest): Promise<SwapQuote> {
    const rawQuote = await this.getQuoteResponse(request);
    return JupiterSwapClient.mapToSwapQuote(rawQuote);
  }

  public async getQuoteResponse(request: JupiterQuoteRequest): Promise<JupiterQuoteResponse> {
    SlippagePolicy.ensureValidBps(request.slippageBps);
    JupiterSwapClient.ensureRawAmount(request.amountRaw);

    const query = JupiterSwapClient.buildQuoteQuery(request);

    const payload = await this.fetchJson<JupiterRawQuoteResponse>(`${this.quoteUrl}?${query.toString()}`, {
      method: 'GET',
    });

    return JupiterSwapClient.parseQuoteResponse(payload);
  }

  public async buildSwapTransaction(
    request: JupiterSwapBuildRequest,
  ): Promise<JupiterSwapBuildResponse> {
    JupiterSwapClient.ensureOptionalNonNegativeInteger(
      request.prioritizationFeeLamports,
      'prioritizationFeeLamports',
    );

    const payload = await this.fetchJson<JupiterRawSwapBuildResponse>(this.swapUrl, {
      method: 'POST',
      body: JSON.stringify({
        quoteResponse: request.quoteResponse,
        userPublicKey: request.userPublicKey.value,
        wrapAndUnwrapSol: request.wrapAndUnwrapSol ?? true,
        dynamicComputeUnitLimit: request.dynamicComputeUnitLimit ?? true,
        prioritizationFeeLamports: request.prioritizationFeeLamports,
      }),
    });

    if (typeof payload.swapTransaction !== 'string' || payload.swapTransaction.length === 0) {
      throw new JupiterSwapClientError('Jupiter swap response does not include swapTransaction.');
    }

    return {
      swapTransactionBase64: payload.swapTransaction,
      lastValidBlockHeight: JupiterSwapClient.toOptionalNumber(payload.lastValidBlockHeight),
      prioritizationFeeLamports: JupiterSwapClient.toOptionalNumber(
        payload.prioritizationFeeLamports,
      ),
      computeUnitLimit: JupiterSwapClient.toOptionalNumber(payload.computeUnitLimit),
    };
  }

  private async fetchJson<T>(url: string, init: RequestInit): Promise<T> {
    return Retry.execute(
      async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
          const response = await fetch(url, {
            ...init,
            headers: {
              Accept: 'application/json',
              ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
              ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}),
              ...init.headers,
            },
            signal: controller.signal,
          });

          if (!response.ok) {
            const message = await JupiterSwapClient.extractErrorMessage(response);
            throw new JupiterSwapClientError(message, response.status);
          }

          return (await response.json()) as T;
        } catch (error) {
          if (error instanceof JupiterSwapClientError) {
            throw error;
          }

          if (error instanceof Error && error.name === 'AbortError') {
            throw new JupiterSwapClientError('Jupiter request timed out.');
          }

          throw new JupiterSwapClientError(
            error instanceof Error ? error.message : 'Unknown Jupiter client error.',
          );
        } finally {
          clearTimeout(timer);
        }
      },
      {
        retries: JupiterSwapClient.MAX_RETRIES,
        baseDelayMs: 250,
        maxDelayMs: 1_000,
        shouldRetry: (error) => {
          if (!(error instanceof JupiterSwapClientError)) {
            return false;
          }

          if (error.message === 'Jupiter request timed out.') {
            return true;
          }

          return error.status === 429 || (error.status !== undefined && error.status >= 500);
        },
      },
    );
  }

  private static mapToSwapQuote(response: JupiterQuoteResponse): SwapQuote {
    const routePlan = response.routePlan.map((item): SwapRouteLeg => {
      return {
        ammLabel: item.swapInfo.label ?? 'Unknown',
        inputMint: new TokenMint(item.swapInfo.inputMint),
        outputMint: new TokenMint(item.swapInfo.outputMint),
        inAmountRaw: item.swapInfo.inAmount,
        outAmountRaw: item.swapInfo.outAmount,
        feeAmountRaw: item.swapInfo.feeAmount,
        feeMint: new TokenMint(item.swapInfo.feeMint),
      };
    });

    return new SwapQuote({
      inputMint: new TokenMint(response.inputMint),
      outputMint: new TokenMint(response.outputMint),
      inAmountRaw: response.inAmount,
      outAmountRaw: response.outAmount,
      otherAmountThresholdRaw: response.otherAmountThreshold,
      slippageBps: response.slippageBps,
      priceImpactPct: response.priceImpactPct,
      routePlan,
      contextSlot: response.contextSlot,
      timeTakenMs:
        response.timeTaken !== undefined ? Math.max(0, Math.round(response.timeTaken * 1000)) : undefined,
    });
  }

  private static toOptionalNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  private static parseQuoteResponse(raw: JupiterRawQuoteResponse): JupiterQuoteResponse {
    if (typeof raw !== 'object' || raw === null) {
      throw new JupiterSwapClientError('Jupiter quote response body is invalid.');
    }

    const rawRecord = raw as Record<string, unknown>;
    const routePlan = JupiterSwapClient.parseRoutePlan(raw.routePlan);
    const swapMode = JupiterSwapClient.parseSwapMode(raw.swapMode);

    return {
      ...rawRecord,
      inputMint: JupiterSwapClient.requireString(raw.inputMint, 'inputMint'),
      inAmount: JupiterSwapClient.requireRawAmount(raw.inAmount, 'inAmount'),
      outputMint: JupiterSwapClient.requireString(raw.outputMint, 'outputMint'),
      outAmount: JupiterSwapClient.requireRawAmount(raw.outAmount, 'outAmount'),
      otherAmountThreshold: JupiterSwapClient.requireRawAmount(
        raw.otherAmountThreshold,
        'otherAmountThreshold',
      ),
      swapMode,
      slippageBps: JupiterSwapClient.requireInteger(raw.slippageBps, 'slippageBps'),
      priceImpactPct: JupiterSwapClient.requireString(raw.priceImpactPct, 'priceImpactPct'),
      routePlan,
      contextSlot: JupiterSwapClient.toOptionalNumber(raw.contextSlot),
      timeTaken: JupiterSwapClient.toOptionalNumber(raw.timeTaken),
    };
  }

  private static parseRoutePlan(raw: unknown): readonly JupiterRoutePlanItem[] {
    if (!Array.isArray(raw)) {
      throw new JupiterSwapClientError('Jupiter quote response routePlan is invalid.');
    }

    return raw.map((item, index) => {
      const value = item as {
        percent?: unknown;
        bps?: unknown;
        swapInfo?: {
          ammKey?: unknown;
          label?: unknown;
          inputMint?: unknown;
          outputMint?: unknown;
          inAmount?: unknown;
          outAmount?: unknown;
          feeAmount?: unknown;
          feeMint?: unknown;
        };
      };

      if (
        typeof value !== 'object' ||
        value === null ||
        !value.swapInfo ||
        value.swapInfo === null ||
        typeof value.swapInfo !== 'object'
      ) {
        throw new JupiterSwapClientError(`Jupiter quote routePlan[${index}] is invalid.`);
      }

      const swapInfo = value.swapInfo;

      return {
        percent: JupiterSwapClient.toOptionalNumber(value.percent),
        bps: JupiterSwapClient.toOptionalNumber(value.bps),
        swapInfo: {
          ammKey: JupiterSwapClient.toOptionalString(swapInfo.ammKey),
          label: JupiterSwapClient.toOptionalString(swapInfo.label),
          inputMint: JupiterSwapClient.requireString(swapInfo.inputMint, 'swapInfo.inputMint'),
          outputMint: JupiterSwapClient.requireString(
            swapInfo.outputMint,
            'swapInfo.outputMint',
          ),
          inAmount: JupiterSwapClient.requireRawAmount(swapInfo.inAmount, 'swapInfo.inAmount'),
          outAmount: JupiterSwapClient.requireRawAmount(swapInfo.outAmount, 'swapInfo.outAmount'),
          feeAmount: JupiterSwapClient.requireRawAmount(swapInfo.feeAmount, 'swapInfo.feeAmount'),
          feeMint: JupiterSwapClient.requireString(swapInfo.feeMint, 'swapInfo.feeMint'),
        },
      };
    });
  }

  private static buildQuoteQuery(request: JupiterQuoteRequest): URLSearchParams {
    const query = new URLSearchParams({
      inputMint: request.inputMint.value,
      outputMint: request.outputMint.value,
      amount: request.amountRaw,
      slippageBps: String(request.slippageBps),
      swapMode: request.swapMode ?? 'ExactIn',
    });

    if (request.onlyDirectRoutes !== undefined) {
      query.set('onlyDirectRoutes', String(request.onlyDirectRoutes));
    }

    if (request.restrictIntermediateTokens !== undefined) {
      query.set('restrictIntermediateTokens', String(request.restrictIntermediateTokens));
    }

    if (request.asLegacyTransaction !== undefined) {
      query.set('asLegacyTransaction', String(request.asLegacyTransaction));
    }

    return query;
  }

  private static parseSwapMode(value: unknown): JupiterSwapMode {
    if (value === 'ExactIn' || value === 'ExactOut') {
      return value;
    }

    throw new JupiterSwapClientError('Jupiter quote swapMode is invalid.');
  }

  private static ensureRawAmount(amountRaw: string): void {
    if (!/^[0-9]+$/.test(amountRaw)) {
      throw new JupiterSwapClientError('Amount must be an integer string in raw units.');
    }

    if (amountRaw === '0') {
      throw new JupiterSwapClientError('Amount must be greater than zero.');
    }
  }

  private static requireRawAmount(value: unknown, fieldName: string): string {
    if (typeof value !== 'string') {
      throw new JupiterSwapClientError(`Jupiter quote field ${fieldName} must be a string.`);
    }

    JupiterSwapClient.ensureRawAmount(value);
    return value;
  }

  private static requireString(value: unknown, fieldName: string): string {
    if (typeof value !== 'string' || value.length === 0) {
      throw new JupiterSwapClientError(`Jupiter quote field ${fieldName} must be a string.`);
    }

    return value;
  }

  private static requireInteger(value: unknown, fieldName: string): number {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new JupiterSwapClientError(`Jupiter quote field ${fieldName} must be an integer.`);
    }

    return value;
  }

  private static toOptionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private static ensureOptionalNonNegativeInteger(
    value: number | undefined,
    fieldName: string,
  ): void {
    if (value === undefined) {
      return;
    }

    if (!Number.isInteger(value) || value < 0) {
      throw new JupiterSwapClientError(`${fieldName} must be a non-negative integer.`);
    }
  }

  private static async extractErrorMessage(response: Response): Promise<string> {
    try {
      const payload = (await response.json()) as { error?: unknown; message?: unknown };
      if (typeof payload.error === 'string' && payload.error.length > 0) {
        return payload.error;
      }

      if (typeof payload.message === 'string' && payload.message.length > 0) {
        return payload.message;
      }
    } catch {
      // no-op: fallback to status text below
    }

    return `Jupiter request failed: HTTP ${response.status}`;
  }
}
