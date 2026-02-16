export class SlippagePolicy {
  public static readonly MIN_BPS = 1;
  public static readonly MAX_BPS = 5_000;
  public static readonly DEFAULT_BPS = 50;

  public static ensureValidBps(slippageBps: number): number {
    if (!Number.isInteger(slippageBps)) {
      throw new Error('Slippage bps must be an integer.');
    }

    if (slippageBps < SlippagePolicy.MIN_BPS || slippageBps > SlippagePolicy.MAX_BPS) {
      throw new Error(
        `Slippage bps must be between ${SlippagePolicy.MIN_BPS} and ${SlippagePolicy.MAX_BPS}.`,
      );
    }

    return slippageBps;
  }

  public static bpsToPercent(slippageBps: number): number {
    const safeBps = SlippagePolicy.ensureValidBps(slippageBps);
    return safeBps / 100;
  }
}
