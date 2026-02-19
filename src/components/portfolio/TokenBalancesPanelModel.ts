import type { BalanceMap } from '@/data/sources/api/BalanceClient';
import type { TokenConfig } from '@/infrastructure/shared/config';

export interface BalanceRow {
  mint: string;
  symbol: string;
  name: string;
  balance: number;
  unitPriceUsd: number;
  valueUsd: number;
}

export class TokenBalancesPanelModel {
  public static fallbackPriceByToken(token: TokenConfig): number {
    if (token.symbol === 'USDC' || token.symbol === 'USDT') {
      return 1;
    }

    return 0;
  }

  public static createFallbackPriceMap(tokens: readonly TokenConfig[]): Map<string, number> {
    return new Map(
      tokens.map((token) => [token.mint.value, TokenBalancesPanelModel.fallbackPriceByToken(token)]),
    );
  }

  public static createBalanceRows(
    tokens: readonly TokenConfig[],
    balances: BalanceMap,
    prices: ReadonlyMap<string, number>,
  ): BalanceRow[] {
    return tokens
      .map((token) => {
        const balance = balances.get(token.mint.value)?.balance ?? 0;
        const unitPriceUsd =
          prices.get(token.mint.value) ?? TokenBalancesPanelModel.fallbackPriceByToken(token);

        return {
          mint: token.mint.value,
          symbol: token.symbol,
          name: token.name,
          balance,
          unitPriceUsd,
          valueUsd: balance * unitPriceUsd,
        };
      })
      .sort((left, right) => right.valueUsd - left.valueUsd);
  }

  public static formatWalletAddress(address: string): string {
    if (address.length <= 14) {
      return address;
    }

    return `${address.slice(0, 6)}...${address.slice(-6)}`;
  }
}
