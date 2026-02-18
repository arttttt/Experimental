import { TokenMint } from '@/domain/models/id/TokenMint';

export interface MarketTokenDefinition {
  symbol: string;
  name: string;
  mint: TokenMint;
  poolAddress: string;
}

export class MarketTokenRegistry {
  private static readonly tokens: readonly MarketTokenDefinition[] = [
    {
      symbol: 'SOL',
      name: 'Wrapped SOL',
      mint: new TokenMint('So11111111111111111111111111111111111111112'),
      poolAddress: 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE',
    },
    {
      symbol: 'USDC',
      name: 'USD Coin',
      mint: new TokenMint('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
      poolAddress: 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE',
    },
  ];

  public static all(): readonly MarketTokenDefinition[] {
    return MarketTokenRegistry.tokens;
  }

  public static defaultToken(): MarketTokenDefinition {
    return MarketTokenRegistry.tokens[0];
  }

  public static bySymbol(symbol: string): MarketTokenDefinition {
    const token = MarketTokenRegistry.tokens.find((item) => item.symbol === symbol);
    return token ?? MarketTokenRegistry.defaultToken();
  }
}
