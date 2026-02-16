export class MarketDataClientError extends Error {
  public readonly source: string;
  public readonly status?: number;

  public constructor(source: string, message: string, status?: number) {
    super(message);
    this.name = 'MarketDataClientError';
    this.source = source;
    this.status = status;
  }
}
