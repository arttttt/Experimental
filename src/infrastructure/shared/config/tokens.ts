import { TokenMint } from '@/domain/models/id';

export type TokenConfig = Readonly<{
  mint: TokenMint;
  symbol: string;
  name: string;
  decimals: number;
}>;

const SOL_MINT = new TokenMint('So11111111111111111111111111111111111111112');
const USDC_MINT = new TokenMint('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const USDT_MINT = new TokenMint('Es9vMFrzaCERmJfrF4H2eid6j8nA5P4ZQfM9N6byN1MZ');

export const TOKENS: readonly TokenConfig[] = [
  {
    mint: SOL_MINT,
    symbol: 'SOL',
    name: 'Solana',
    decimals: 9,
  },
  {
    mint: USDC_MINT,
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
  },
  {
    mint: USDT_MINT,
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
  },
];

export class TokenRegistry {
  public static getByMint(mint: TokenMint): TokenConfig | undefined {
    return TOKENS.find((token) => token.mint.equals(mint));
  }

  public static getBySymbol(symbol: string): TokenConfig | undefined {
    return TOKENS.find((token) => token.symbol.toUpperCase() === symbol.toUpperCase());
  }
}
