import { useMemo, useRef, useState } from 'react';
import Decimal from 'decimal.js';

import {
  JupiterSwapClient,
  type JupiterQuoteResponse,
} from '@/data/sources/api/JupiterSwapClient';
import { TransactionClient } from '@/data/sources/api/TransactionClient';
import { WalletAddress } from '@/domain/models/id';
import { SlippagePolicy } from '@/domain/policies';
import { TOKENS, type TokenConfig } from '@/infrastructure/shared/config';

type SwapFormPanelProps = Readonly<{
  defaultWalletAddress: string;
}>;

type QuoteSnapshot = Readonly<{
  inputMint: string;
  outputMint: string;
  amountRaw: string;
  slippageBps: number;
}>;

type QuoteState = Readonly<{
  response: JupiterQuoteResponse;
  snapshot: QuoteSnapshot;
  quotedAtMs: number;
}>;

type ExecutionState = Readonly<{
  success: boolean;
  message: string;
  signature: string | null;
}>;

const DEFAULT_INPUT_SYMBOL = 'SOL';
const DEFAULT_OUTPUT_SYMBOL = 'USDC';
const AMOUNT_PRESETS = ['0.1', '0.5', '1.0'] as const;
const SLIPPAGE_PRESETS = ['0.10', '0.50', '1.00'] as const;
const DEFAULT_ENCRYPTED_PRIVATE_KEY =
  typeof import.meta.env.VITE_DEMO_WALLET_ENCRYPTED_KEY === 'string'
    ? import.meta.env.VITE_DEMO_WALLET_ENCRYPTED_KEY.trim()
    : '';

const jupiterSwapClient = new JupiterSwapClient();
const transactionClient = new TransactionClient();

function findTokenBySymbol(symbol: string): TokenConfig {
  return TOKENS.find((token) => token.symbol === symbol) ?? TOKENS[0];
}

function findTokenByMint(mint: string): TokenConfig | null {
  return TOKENS.find((token) => token.mint.value === mint) ?? null;
}

function normalizeAmountToRaw(uiAmount: string, decimals: number): string {
  const trimmed = uiAmount.trim();
  if (trimmed.length === 0) {
    throw new Error('Amount is required.');
  }

  const amount = new Decimal(trimmed);
  if (!amount.isFinite() || amount.lte(0)) {
    throw new Error('Amount must be greater than zero.');
  }

  const scaled = amount.mul(new Decimal(10).pow(decimals));
  if (!scaled.isInteger()) {
    throw new Error(`Amount exceeds ${decimals} decimal places.`);
  }

  return scaled.toFixed(0);
}

function parseSlippageBps(slippagePercent: string): number {
  const trimmed = slippagePercent.trim();
  if (trimmed.length === 0) {
    throw new Error('Slippage is required.');
  }

  const percent = new Decimal(trimmed);
  if (!percent.isFinite() || percent.lte(0)) {
    throw new Error('Slippage must be greater than zero.');
  }

  const slippageBps = percent.mul(100);
  if (!slippageBps.isInteger()) {
    throw new Error('Slippage precision is limited to two decimal places.');
  }

  return SlippagePolicy.ensureValidBps(slippageBps.toNumber());
}

function formatRawAmount(raw: string, decimals: number, maxFractionDigits: number): string {
  const value = new Decimal(raw).div(new Decimal(10).pow(decimals));
  const normalized = value.toFixed(maxFractionDigits).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  const [whole, fraction] = normalized.split('.');
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  return fraction ? `${groupedWhole}.${fraction}` : groupedWhole;
}

function isSameQuoteRequest(left: QuoteSnapshot, right: QuoteSnapshot): boolean {
  return (
    left.inputMint === right.inputMint &&
    left.outputMint === right.outputMint &&
    left.amountRaw === right.amountRaw &&
    left.slippageBps === right.slippageBps
  );
}

function getErrorMessage(reason: unknown, fallback: string): string {
  if (reason instanceof Error && reason.message.length > 0) {
    return reason.message;
  }

  return fallback;
}

function getPriceImpactTone(priceImpactPct: string): string {
  const value = Number(priceImpactPct);
  if (!Number.isFinite(value)) {
    return 'text-slate-100';
  }

  if (value >= 2) {
    return 'text-red-300';
  }

  if (value >= 1) {
    return 'text-amber-300';
  }

  return 'text-emerald-300';
}

export function SwapFormPanel({ defaultWalletAddress }: SwapFormPanelProps) {
  const [inputSymbol, setInputSymbol] = useState<string>(DEFAULT_INPUT_SYMBOL);
  const [outputSymbol, setOutputSymbol] = useState<string>(DEFAULT_OUTPUT_SYMBOL);
  const [inputAmount, setInputAmount] = useState<string>('0.1');
  const [slippagePercent, setSlippagePercent] = useState<string>('0.50');

  const [walletAddressInput, setWalletAddressInput] = useState<string>(defaultWalletAddress);
  const [encryptedPrivateKey, setEncryptedPrivateKey] = useState<string>(DEFAULT_ENCRYPTED_PRIVATE_KEY);
  const [walletPassword, setWalletPassword] = useState<string>('');

  const [quoteState, setQuoteState] = useState<QuoteState | null>(null);
  const [executionState, setExecutionState] = useState<ExecutionState | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [isQuoting, setIsQuoting] = useState<boolean>(false);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const quoteRequestIdRef = useRef<number>(0);
  const executeRequestIdRef = useRef<number>(0);

  const inputToken = useMemo(() => findTokenBySymbol(inputSymbol), [inputSymbol]);
  const outputToken = useMemo(() => findTokenBySymbol(outputSymbol), [outputSymbol]);

  const validationState = useMemo(() => {
    if (inputToken.mint.equals(outputToken.mint)) {
      return {
        amountRaw: null,
        slippageBps: null,
        requestError: 'Input and output tokens must be different.',
      };
    }

    try {
      const amountRaw = normalizeAmountToRaw(inputAmount, inputToken.decimals);
      const slippageBps = parseSlippageBps(slippagePercent);
      return {
        amountRaw,
        slippageBps,
        requestError: null,
      };
    } catch (reason) {
      return {
        amountRaw: null,
        slippageBps: null,
        requestError: getErrorMessage(reason, 'Swap request is invalid.'),
      };
    }
  }, [inputAmount, inputToken, outputToken, slippagePercent]);

  const currentSnapshot = useMemo<QuoteSnapshot | null>(() => {
    if (!validationState.amountRaw || !validationState.slippageBps) {
      return null;
    }

    return {
      inputMint: inputToken.mint.value,
      outputMint: outputToken.mint.value,
      amountRaw: validationState.amountRaw,
      slippageBps: validationState.slippageBps,
    };
  }, [inputToken, outputToken, validationState]);

  const quoteIsStale =
    quoteState !== null && currentSnapshot !== null
      ? !isSameQuoteRequest(quoteState.snapshot, currentSnapshot)
      : quoteState !== null;

  const quotedInputToken = useMemo(() => {
    if (!quoteState) {
      return inputToken;
    }

    return findTokenByMint(quoteState.response.inputMint) ?? inputToken;
  }, [inputToken, quoteState]);

  const quotedOutputToken = useMemo(() => {
    if (!quoteState) {
      return outputToken;
    }

    return findTokenByMint(quoteState.response.outputMint) ?? outputToken;
  }, [outputToken, quoteState]);

  const parsedWalletAddress = useMemo(() => {
    try {
      return new WalletAddress(walletAddressInput.trim());
    } catch {
      return null;
    }
  }, [walletAddressInput]);

  const canGetQuote =
    !isQuoting &&
    !isExecuting &&
    validationState.requestError === null &&
    currentSnapshot !== null;

  const executionReadinessError = useMemo(() => {
    if (quoteState === null) {
      return 'Quote is required before execution.';
    }

    if (quoteIsStale) {
      return 'Quote is stale. Refresh quote before executing.';
    }

    if (parsedWalletAddress === null) {
      return 'Wallet address is invalid.';
    }

    if (encryptedPrivateKey.trim().length === 0) {
      return 'Encrypted private key is required.';
    }

    if (walletPassword.trim().length === 0) {
      return 'Wallet password is required.';
    }

    return null;
  }, [encryptedPrivateKey, parsedWalletAddress, quoteIsStale, quoteState, walletPassword]);

  const canExecute = !isExecuting && !isQuoting && executionReadinessError === null;

  const handleFlipTokens = (): void => {
    const nextInput = outputSymbol;
    const nextOutput = inputSymbol;
    setInputSymbol(nextInput);
    setOutputSymbol(nextOutput);
    setExecutionState(null);
    setExecutionError(null);
  };

  const handleQuote = async (): Promise<void> => {
    if (!currentSnapshot) {
      return;
    }

    setIsQuoting(true);
    setQuoteError(null);
    setExecutionError(null);
    setExecutionState(null);
    quoteRequestIdRef.current += 1;
    const requestId = quoteRequestIdRef.current;

    try {
      const quoteResponse = await jupiterSwapClient.getQuoteResponse({
        inputMint: inputToken.mint,
        outputMint: outputToken.mint,
        amountRaw: currentSnapshot.amountRaw,
        slippageBps: currentSnapshot.slippageBps,
        swapMode: 'ExactIn',
        restrictIntermediateTokens: false,
      });

      if (requestId !== quoteRequestIdRef.current) {
        return;
      }

      setQuoteState({
        response: quoteResponse,
        snapshot: currentSnapshot,
        quotedAtMs: Date.now(),
      });
    } catch (reason) {
      if (requestId !== quoteRequestIdRef.current) {
        return;
      }

      setQuoteState(null);
      setQuoteError(getErrorMessage(reason, 'Failed to fetch quote.'));
    } finally {
      if (requestId === quoteRequestIdRef.current) {
        setIsQuoting(false);
      }
    }
  };

  const handleExecute = async (): Promise<void> => {
    if (!quoteState || quoteIsStale || !parsedWalletAddress) {
      return;
    }

    setIsExecuting(true);
    setExecutionError(null);
    setExecutionState(null);
    executeRequestIdRef.current += 1;
    const requestId = executeRequestIdRef.current;

    try {
      const buildResult = await jupiterSwapClient.buildSwapTransaction({
        userPublicKey: parsedWalletAddress,
        quoteResponse: quoteState.response,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
      });

      const sendResult = await transactionClient.signAndSend(
        buildResult.swapTransactionBase64,
        encryptedPrivateKey.trim(),
        walletPassword,
      );

      if (requestId !== executeRequestIdRef.current) {
        return;
      }

      if (!sendResult.success) {
        setExecutionError(sendResult.error ?? 'Swap transaction failed.');
        return;
      }

      const signature = sendResult.signature?.value ?? null;
      setExecutionState({
        success: true,
        message: sendResult.confirmed
          ? 'Swap submitted and confirmed on-chain.'
          : 'Swap submitted. Confirmation is still pending.',
        signature,
      });
    } catch (reason) {
      if (requestId !== executeRequestIdRef.current) {
        return;
      }

      setExecutionError(getErrorMessage(reason, 'Failed to execute swap transaction.'));
    } finally {
      if (requestId === executeRequestIdRef.current) {
        setIsExecuting(false);
      }
    }
  };

  const quoteRouteLabels = quoteState
    ? Array.from(
        new Set(
          quoteState.response.routePlan.map((step) => {
            return step.swapInfo.label ?? 'Unknown';
          }),
        ),
      )
    : [];

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-2xl shadow-slate-950/40 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Swap</p>
          <h2 className="text-lg font-semibold text-slate-50">Market swap</h2>
          <p className="mt-1 text-xs text-slate-400">Fetch a Jupiter quote and execute with wallet confirmation.</p>
        </div>
        <div className="rounded-md border border-slate-700 bg-slate-950/60 px-3 py-1.5 text-right text-[0.68rem] uppercase tracking-[0.12em] text-slate-400">
          {quoteState ? `Quoted ${new Date(quoteState.quotedAtMs).toLocaleTimeString()}` : 'No quote yet'}
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-end">
        <label className="space-y-1">
          <span className="text-xs text-slate-400">From</span>
          <select
            value={inputSymbol}
            onChange={(event) => setInputSymbol(event.target.value)}
            disabled={isQuoting || isExecuting}
            className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 focus:border-cyan-400/60 focus:outline-none"
          >
            {TOKENS.map((token) => (
              <option key={token.mint.value} value={token.symbol}>
                {token.symbol} - {token.name}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={handleFlipTokens}
          disabled={isQuoting || isExecuting}
          className="rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-slate-600 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Flip
        </button>

        <label className="space-y-1">
          <span className="text-xs text-slate-400">To</span>
          <select
            value={outputSymbol}
            onChange={(event) => setOutputSymbol(event.target.value)}
            disabled={isQuoting || isExecuting}
            className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 focus:border-cyan-400/60 focus:outline-none"
          >
            {TOKENS.map((token) => (
              <option key={token.mint.value} value={token.symbol}>
                {token.symbol} - {token.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs text-slate-400">Amount ({inputToken.symbol})</span>
          <input
            type="text"
            inputMode="decimal"
            value={inputAmount}
            onChange={(event) => setInputAmount(event.target.value)}
            placeholder="0.00"
            disabled={isQuoting || isExecuting}
            className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400/60 focus:outline-none"
          />
          <div className="flex flex-wrap gap-1">
            {AMOUNT_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setInputAmount(preset)}
                disabled={isQuoting || isExecuting}
                className="rounded border border-slate-700 bg-slate-900/70 px-2 py-1 text-[0.68rem] text-slate-300 transition hover:border-slate-600 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {preset}
              </button>
            ))}
          </div>
        </label>

        <label className="space-y-1">
          <span className="text-xs text-slate-400">Slippage (%)</span>
          <input
            type="text"
            inputMode="decimal"
            value={slippagePercent}
            onChange={(event) => setSlippagePercent(event.target.value)}
            placeholder={(SlippagePolicy.DEFAULT_BPS / 100).toFixed(2)}
            disabled={isQuoting || isExecuting}
            className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400/60 focus:outline-none"
          />
          <div className="flex flex-wrap gap-1">
            {SLIPPAGE_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setSlippagePercent(preset)}
                disabled={isQuoting || isExecuting}
                className="rounded border border-slate-700 bg-slate-900/70 px-2 py-1 text-[0.68rem] text-slate-300 transition hover:border-slate-600 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {preset}%
              </button>
            ))}
          </div>
        </label>
      </div>

      <button
        type="button"
        onClick={() => {
          void handleQuote();
        }}
        disabled={!canGetQuote}
        className="mt-4 w-full rounded-md border border-cyan-500/60 bg-cyan-500/15 px-3 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isQuoting ? 'Requesting quote...' : 'Get Quote'}
      </button>

      {validationState.requestError ? (
        <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          {validationState.requestError}
        </p>
      ) : null}

      {quoteError ? (
        <p className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {quoteError}
        </p>
      ) : null}

      {quoteState ? (
        <div className="mt-4 space-y-3 rounded-lg border border-slate-800 bg-slate-950/55 p-3">
          {quoteIsStale ? (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
              Quote is stale. Refresh quote before executing.
            </p>
          ) : null}

          <div className="grid gap-3 text-sm text-slate-200 md:grid-cols-2">
            <div>
              <p className="text-[0.68rem] uppercase tracking-[0.14em] text-slate-500">You pay</p>
              <p className="mt-1 font-medium text-slate-100">
                {formatRawAmount(
                  quoteState.response.inAmount,
                  quotedInputToken.decimals,
                  quotedInputToken.decimals,
                )}{' '}
                {quotedInputToken.symbol}
              </p>
            </div>

            <div>
              <p className="text-[0.68rem] uppercase tracking-[0.14em] text-slate-500">You receive</p>
              <p className="mt-1 font-medium text-emerald-300">
                {formatRawAmount(
                  quoteState.response.outAmount,
                  quotedOutputToken.decimals,
                  quotedOutputToken.decimals,
                )}{' '}
                {quotedOutputToken.symbol}
              </p>
            </div>
          </div>

          <div className="grid gap-3 text-xs text-slate-300 md:grid-cols-3">
            <p>
              Min received:{' '}
              <span className="font-medium text-slate-100">
                {formatRawAmount(
                  quoteState.response.otherAmountThreshold,
                  quotedOutputToken.decimals,
                  quotedOutputToken.decimals,
                )}{' '}
                {quotedOutputToken.symbol}
              </span>
            </p>
            <p>
              Price impact:{' '}
              <span className={[`font-medium`, getPriceImpactTone(quoteState.response.priceImpactPct)].join(' ')}>
                {quoteState.response.priceImpactPct}%
              </span>
            </p>
            <p>
              Route: <span className="font-medium text-slate-100">{quoteRouteLabels.join(' -> ') || 'Unknown'}</span>
            </p>
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[0.68rem] text-slate-500">
            <p>Route legs: {quoteState.response.routePlan.length}</p>
            <p>
              Quote latency:{' '}
              {quoteState.response.timeTaken !== undefined
                ? `${Math.round(quoteState.response.timeTaken * 1000)}ms`
                : 'n/a'}
            </p>
            <p>Context slot: {quoteState.response.contextSlot ?? 'n/a'}</p>
          </div>

          <div className="space-y-2 border-t border-slate-800 pt-3">
            <p className="text-[0.68rem] uppercase tracking-[0.14em] text-slate-500">Execution</p>

            <label className="space-y-1">
              <span className="text-xs text-slate-400">Wallet address</span>
              <input
                type="text"
                value={walletAddressInput}
                onChange={(event) => setWalletAddressInput(event.target.value)}
                disabled={isExecuting}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-cyan-400/60 focus:outline-none"
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs text-slate-400">Encrypted private key (base64)</span>
              <textarea
                value={encryptedPrivateKey}
                onChange={(event) => setEncryptedPrivateKey(event.target.value)}
                rows={2}
                disabled={isExecuting}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="Paste wallet encrypted key"
                className="w-full resize-none rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-cyan-400/60 focus:outline-none"
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs text-slate-400">Wallet password</span>
              <input
                type="password"
                value={walletPassword}
                onChange={(event) => setWalletPassword(event.target.value)}
                disabled={isExecuting}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-cyan-400/60 focus:outline-none"
              />
            </label>

            <button
              type="button"
              onClick={() => {
                void handleExecute();
              }}
              disabled={!canExecute}
              className="w-full rounded-md border border-emerald-500/50 bg-emerald-500/15 px-3 py-2 text-sm font-medium text-emerald-100 transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isExecuting ? 'Executing swap...' : 'Execute Swap'}
            </button>

            {executionReadinessError ? (
              <p className="text-xs text-slate-500">{executionReadinessError}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {executionError ? (
        <p className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {executionError}
        </p>
      ) : null}

      {executionState ? (
        <div
          className={[
            'mt-3 rounded-md border px-3 py-2 text-xs',
            executionState.success
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-100',
          ].join(' ')}
        >
          <p>{executionState.message}</p>
          {executionState.signature ? (
            <a
              href={`https://solscan.io/tx/${executionState.signature}`}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block text-cyan-300 underline underline-offset-2"
            >
              View transaction: {executionState.signature.slice(0, 8)}...{executionState.signature.slice(-8)}
            </a>
          ) : null}
        </div>
      ) : null}

      <p className="mt-3 text-[0.68rem] text-slate-500">
        Slippage bounds: {SlippagePolicy.MIN_BPS / 100}% to {SlippagePolicy.MAX_BPS / 100}%.
      </p>
    </section>
  );
}
