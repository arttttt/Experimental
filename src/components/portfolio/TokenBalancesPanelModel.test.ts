import { describe, expect, it } from 'vitest';

import { TokenBalancesPanelModel } from '@/components/portfolio/TokenBalancesPanelModel';
import { TOKENS } from '@/infrastructure/shared/config';

describe('TokenBalancesPanelModel', () => {
  it('returns stablecoin fallback prices', () => {
    expect(TokenBalancesPanelModel.fallbackPriceByToken(TOKENS[1])).toBe(1);
    expect(TokenBalancesPanelModel.fallbackPriceByToken(TOKENS[2])).toBe(1);
    expect(TokenBalancesPanelModel.fallbackPriceByToken(TOKENS[0])).toBe(0);
  });

  it('sorts rows by usd value desc', () => {
    const balances = new Map([
      [TOKENS[0].mint.value, { symbol: TOKENS[0].symbol, balance: 2, mint: TOKENS[0].mint, decimals: 9 }],
      [TOKENS[1].mint.value, { symbol: TOKENS[1].symbol, balance: 1, mint: TOKENS[1].mint, decimals: 6 }],
    ]);
    const prices = new Map([
      [TOKENS[0].mint.value, 120],
      [TOKENS[1].mint.value, 1],
    ]);

    const rows = TokenBalancesPanelModel.createBalanceRows(TOKENS, balances, prices);

    expect(rows[0].symbol).toBe('SOL');
    expect(rows[0].valueUsd).toBe(240);
    expect(rows[1].symbol).toBe('USDC');
    expect(rows[2].symbol).toBe('USDT');
  });

  it('shortens long wallet addresses', () => {
    const address = '6QWeT6FpJrm8AF1btu6WH2k2Xhq2jRPjZ8M2Wspxt3r9';
    expect(TokenBalancesPanelModel.formatWalletAddress(address)).toBe('6QWeT6...pxt3r9');
    expect(TokenBalancesPanelModel.formatWalletAddress('short-address')).toBe('short-address');
  });
});
