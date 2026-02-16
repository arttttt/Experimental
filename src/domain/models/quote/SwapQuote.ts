import { TokenMint } from '@/domain/models/id';

export type SwapRouteLeg = Readonly<{
  ammLabel: string;
  inputMint: TokenMint;
  outputMint: TokenMint;
  inAmountRaw: string;
  outAmountRaw: string;
  feeAmountRaw: string;
  feeMint: TokenMint;
}>;

export type SwapQuoteParams = Readonly<{
  inputMint: TokenMint;
  outputMint: TokenMint;
  inAmountRaw: string;
  outAmountRaw: string;
  otherAmountThresholdRaw: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: readonly SwapRouteLeg[];
  contextSlot?: number;
  timeTakenMs?: number;
}>;

export class SwapQuote {
  public readonly inputMint: TokenMint;
  public readonly outputMint: TokenMint;
  public readonly inAmountRaw: string;
  public readonly outAmountRaw: string;
  public readonly otherAmountThresholdRaw: string;
  public readonly slippageBps: number;
  public readonly priceImpactPct: string;
  public readonly routePlan: readonly SwapRouteLeg[];
  public readonly contextSlot?: number;
  public readonly timeTakenMs?: number;

  public constructor(params: SwapQuoteParams) {
    this.inputMint = params.inputMint;
    this.outputMint = params.outputMint;
    this.inAmountRaw = params.inAmountRaw;
    this.outAmountRaw = params.outAmountRaw;
    this.otherAmountThresholdRaw = params.otherAmountThresholdRaw;
    this.slippageBps = params.slippageBps;
    this.priceImpactPct = params.priceImpactPct;
    this.routePlan = params.routePlan;
    this.contextSlot = params.contextSlot;
    this.timeTakenMs = params.timeTakenMs;
  }
}
