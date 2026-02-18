export class JupiterSwapClientError extends Error {
  public readonly status?: number;

  public constructor(message: string, status?: number) {
    super(message);
    this.name = 'JupiterSwapClientError';
    this.status = status;
  }
}
