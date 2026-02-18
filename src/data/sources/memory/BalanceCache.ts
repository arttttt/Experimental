import { WalletAddress, type TokenMint } from '@/domain/models/id';

interface BalanceCacheEntry {
  expiresAtMs: number;
  balance: number;
}

export class BalanceCache {
  private readonly entries = new Map<string, BalanceCacheEntry>();
  private readonly ttlMs: number;

  public constructor(params?: { ttlMs?: number }) {
    this.ttlMs = params?.ttlMs ?? 30_000;
  }

  public get(address: WalletAddress, mint: TokenMint | string): number | null {
    const key = BalanceCache.createKey(address, mint);
    const cached = this.entries.get(key);

    if (!cached) {
      return null;
    }

    if (Date.now() > cached.expiresAtMs) {
      this.entries.delete(key);
      return null;
    }

    return cached.balance;
  }

  public set(address: WalletAddress, mint: TokenMint | string, balance: number): void {
    this.entries.set(BalanceCache.createKey(address, mint), {
      expiresAtMs: Date.now() + this.ttlMs,
      balance,
    });
  }

  public invalidate(address: WalletAddress): void {
    const prefix = `${address.value}|`;

    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key);
      }
    }
  }

  private static createKey(address: WalletAddress, mint: TokenMint | string): string {
    const mintValue = typeof mint === 'string' ? mint : mint.value;
    return `${address.value}|${mintValue}`;
  }
}
