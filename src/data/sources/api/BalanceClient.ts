import Decimal from 'decimal.js';

import { BatchRpcClient } from '@/data/sources/api/BatchRpcClient';
import { TokenMint, WalletAddress } from '@/domain/models/id';
import type { TokenConfig } from '@/infrastructure/shared/config/tokens';
import { Precision } from '@/infrastructure/shared/math';
import { Retry } from '@/infrastructure/shared/resilience';
import { BalanceCache } from '@/data/sources/memory/BalanceCache';

const NATIVE_SOL_MINT = new TokenMint('So11111111111111111111111111111111111111112');
const SOL_DECIMALS = 9;

type JsonRpcResponse = Readonly<{
  result?: unknown;
  error?: Readonly<{
    code: number;
    message: string;
  }>;
}>;

export type BalanceEntry = Readonly<{
  symbol: string;
  balance: number;
  mint: TokenMint;
  decimals: number;
}>;

export type BalanceMap = Map<string, BalanceEntry>;

interface ParsedTokenAccountResult {
  value?: unknown[];
}

interface ParsedTokenAccountInfo {
  tokenAmount?: {
    amount?: string;
  };
}

type RpcBalanceRequest = {
  id: number;
  token?: TokenConfig;
  method: 'getBalance' | 'getTokenAccountsByOwner';
  params: unknown[];
};

export class BalanceService {
  private readonly rpcUrl: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly baseDelayMs: number;
  private readonly balanceCache: BalanceCache;
  private readonly batchRpcClient: BatchRpcClient;

  public constructor(params?: {
    rpcUrl?: string;
    timeoutMs?: number;
    retries?: number;
    baseDelayMs?: number;
    cacheTtlMs?: number;
    balanceCache?: BalanceCache;
    batchRpcClient?: BatchRpcClient;
  }) {
    this.rpcUrl = params?.rpcUrl ?? 'https://api.mainnet-beta.solana.com';
    this.timeoutMs = params?.timeoutMs ?? 8_000;
    this.retries = params?.retries ?? 2;
    this.baseDelayMs = params?.baseDelayMs ?? 250;
    this.balanceCache =
      params?.balanceCache ??
      new BalanceCache({
        ttlMs: params?.cacheTtlMs ?? 30_000,
      });
    this.batchRpcClient =
      params?.batchRpcClient ??
      new BatchRpcClient({
        rpcUrl: this.rpcUrl,
        timeoutMs: this.timeoutMs,
        retries: this.retries,
        baseDelayMs: this.baseDelayMs,
      });
  }

  public async getSolBalance(address: WalletAddress): Promise<number> {
    const cached = this.balanceCache.get(address, NATIVE_SOL_MINT);
    if (cached !== null) {
      return cached;
    }

    const result = await this.callRpc('getBalance', [address.value]);
    const lamports = BalanceService.extractLamports(result);
    const balance = Number(Precision.toHumanAmount(lamports, SOL_DECIMALS));
    this.balanceCache.set(address, NATIVE_SOL_MINT, balance);
    return balance;
  }

  public async getTokenBalance(
    address: WalletAddress,
    mint: TokenMint,
    decimals: number,
  ): Promise<number> {
    const cached = this.balanceCache.get(address, mint);
    if (cached !== null) {
      return cached;
    }

    const result = await this.callRpc('getTokenAccountsByOwner', [
      address.value,
      { mint: mint.value },
      { encoding: 'jsonParsed' },
    ]);

    const balance = BalanceService.parseTokenBalance(result, decimals);
    this.balanceCache.set(address, mint, balance);
    return balance;
  }

  public async getAllBalances(address: WalletAddress, tokens: TokenConfig[]): Promise<BalanceMap> {
    if (tokens.length === 0) {
      return new Map();
    }

    const cached = this.getCachedBalances(address, tokens);
    if (cached) {
      return cached;
    }

    const requests = BalanceService.createBalanceRequests(address, tokens);

    try {
      const responses = await this.batchRpcClient.execute(requests);
      const resultMap: BalanceMap = new Map();
      const requestIdByMint = BalanceService.createRequestIdByMint(requests);

      const solResponse = responses.get(1);
      const solLamports = BalanceService.extractLamports(solResponse);
      const solBalance = Number(Precision.toHumanAmount(solLamports, SOL_DECIMALS));

      for (const token of tokens) {
        if (BalanceService.isNativeSol(token.mint)) {
          resultMap.set(token.mint.value, {
            symbol: token.symbol,
            balance: solBalance,
            mint: token.mint,
            decimals: token.decimals,
          });
          this.balanceCache.set(address, token.mint, solBalance);
          continue;
        }

        const requestId = requestIdByMint.get(token.mint.value);
        const tokenResult = requestId ? responses.get(requestId) : undefined;
        const tokenBalance = BalanceService.parseTokenBalance(tokenResult, token.decimals);
        resultMap.set(token.mint.value, {
          symbol: token.symbol,
          balance: tokenBalance,
          mint: token.mint,
          decimals: token.decimals,
        });
        this.balanceCache.set(address, token.mint, tokenBalance);
      }

      return resultMap;
    } catch (error) {
      const fallbackCached = this.getCachedBalances(address, tokens);
      if (fallbackCached && BalanceService.shouldRetry(error)) {
        return fallbackCached;
      }

      throw error;
    }
  }

  public invalidate(address: WalletAddress): void {
    this.balanceCache.invalidate(address);
  }

  private async callRpc(method: string, params: unknown[]): Promise<unknown> {
    const response = await Retry.execute(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const result = await fetch(this.rpcUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method,
            params,
          }),
          signal: controller.signal,
        });

        if (!result.ok) {
          throw new Error(`HTTP ${result.status}`);
        }

        const payload = (await result.json()) as JsonRpcResponse;
        if (payload.error) {
          throw new Error(`RPC ${payload.error.code}: ${payload.error.message}`);
        }

        return payload.result;
      } finally {
        clearTimeout(timer);
      }
    }, {
      retries: this.retries,
      baseDelayMs: this.baseDelayMs,
      shouldRetry: BalanceService.shouldRetry,
    });

    return response;
  }

  private getCachedBalances(address: WalletAddress, tokens: TokenConfig[]): BalanceMap | null {
    const resultMap: BalanceMap = new Map();

    for (const token of tokens) {
      const cached = this.balanceCache.get(address, token.mint);
      if (cached === null) {
        return null;
      }

      resultMap.set(token.mint.value, {
        symbol: token.symbol,
        balance: cached,
        mint: token.mint,
        decimals: token.decimals,
      });
    }

    return resultMap;
  }

  private static isNativeSol(mint: TokenMint): boolean {
    return mint.equals(NATIVE_SOL_MINT);
  }

  private static extractLamports(rawResult: unknown): string | number {
    if (!rawResult || typeof rawResult !== 'object') {
      throw new Error('Invalid getBalance response: missing result object.');
    }

    if (!('value' in rawResult)) {
      throw new Error('Invalid getBalance response: missing lamports value.');
    }

    if (typeof rawResult.value === 'number') {
      return rawResult.value;
    }

    if (typeof rawResult.value === 'string' && /^\d+$/.test(rawResult.value)) {
      return rawResult.value;
    }

    throw new Error('Invalid getBalance response: lamports has unsupported type.');
  }

  private static parseTokenBalance(rawResult: unknown, decimals: number): number {
    const values = BalanceService.extractTokenAccounts(rawResult);

    if (values.length === 0) {
      return 0;
    }

    let totalRawAmount = new Decimal(0);

    for (const account of values) {
      const amount = BalanceService.extractTokenAmount(account);
      totalRawAmount = totalRawAmount.add(amount);
    }

    return Number(Precision.toHumanAmount(totalRawAmount.toFixed(0), decimals));
  }

  private static extractTokenAmount(account: unknown): string {
    if (!account || typeof account !== 'object') {
      return '0';
    }

    if (!('account' in account) || !account.account || typeof account.account !== 'object') {
      return '0';
    }

    const accountData = account.account as { data?: unknown };
    if (!accountData.data || typeof accountData.data !== 'object') {
      return '0';
    }

    const data = accountData.data as { parsed?: unknown };
    if (!data.parsed || typeof data.parsed !== 'object') {
      return '0';
    }

    const parsed = data.parsed as { info?: unknown };
    const info = parsed.info as ParsedTokenAccountInfo | undefined;
    const amount = info?.tokenAmount?.amount;

    if (!amount || typeof amount !== 'string') {
      return '0';
    }

    if (!/^\d+$/.test(amount)) {
      return '0';
    }

    return amount;
  }

  private static extractTokenAccounts(rawResult: unknown): unknown[] {
    const parsed = rawResult as ParsedTokenAccountResult | undefined;
    return Array.isArray(parsed?.value) ? parsed.value : [];
  }

  private static createBalanceRequests(
    address: WalletAddress,
    tokens: readonly TokenConfig[],
  ): RpcBalanceRequest[] {
    const requests: RpcBalanceRequest[] = [
      {
        id: 1,
        method: 'getBalance',
        params: [address.value],
      },
    ];

    let nextId = 2;
    for (const token of tokens) {
      if (BalanceService.isNativeSol(token.mint)) {
        continue;
      }

      requests.push({
        id: nextId,
        token,
        method: 'getTokenAccountsByOwner',
        params: [address.value, { mint: token.mint.value }, { encoding: 'jsonParsed' }],
      });
      nextId += 1;
    }

    return requests;
  }

  private static createRequestIdByMint(requests: readonly RpcBalanceRequest[]): Map<string, number> {
    const requestIdByMint = new Map<string, number>();

    for (const request of requests) {
      if (request.token) {
        requestIdByMint.set(request.token.mint.value, request.id);
      }
    }

    return requestIdByMint;
  }

  private static shouldRetry(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return true;
    }

    const message = error.message.toLowerCase();
    return (
      message.includes('429') ||
      message.includes('rate') ||
      message.includes('timeout') ||
      message.includes('network') ||
      message.includes('fetch') ||
      message.includes('http 5')
    );
  }
}

export { BalanceService as BalanceClient };
