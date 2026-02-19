import {
  createKeyPairSignerFromPrivateKeyBytes,
  createSolanaRpc,
  getTransactionDecoder,
  getTransactionEncoder,
  signTransaction,
  type Commitment,
  type ReadonlyUint8Array,
  type Signature,
} from '@solana/kit';

import { TxSignature } from '@/domain/models/id';
import { Retry } from '@/infrastructure/shared/resilience';
import { ipc } from '@/lib/ipc';

const DEFAULT_RPC_URL = 'https://api.mainnet-beta.solana.com';
const DEFAULT_CONFIRMATION_TIMEOUT_MS = 30_000;
const SEND_RETRIES = 2;
const SEND_RETRY_BASE_DELAY_MS = 300;
const SEND_RETRY_MAX_DELAY_MS = 1_500;
const CONFIRMATION_BASE_DELAY_MS = 1_000;
const CONFIRMATION_MAX_DELAY_MS = 4_000;
const PRIVATE_KEY_LENGTH_BYTES = 32;

type SignatureStatusValue = Readonly<{
  confirmationStatus?: Commitment | null;
  err?: unknown;
}>;

type SignatureStatusesPayload = Readonly<{
  value?: ReadonlyArray<SignatureStatusValue | null>;
}>;

type RpcRequest<TResponse> = Readonly<{
  send: () => Promise<TResponse>;
}>;

type RpcClient = Readonly<{
  sendTransaction: (
    transactionBase64: string,
    config: Readonly<{
      encoding: 'base64';
      skipPreflight: boolean;
      preflightCommitment: Commitment;
    }>,
  ) => RpcRequest<Signature | string>;
  getSignatureStatuses: (
    signatures: Signature[],
    config?: Readonly<{ searchTransactionHistory?: boolean }>,
  ) => RpcRequest<unknown>;
}>;

export type ConfirmationStatus = 'confirmed' | 'timeout' | 'failed';

export type SendTransactionResult = Readonly<{
  success: boolean;
  signature: TxSignature | null;
  error: string | null;
  confirmed: boolean;
}>;

export type TransactionServiceParams = Readonly<{
  rpcUrl?: string;
  confirmationTimeoutMs?: number;
  sendRetryBaseDelayMs?: number;
  sendRetryMaxDelayMs?: number;
  decryptPrivateKey?: (encryptedPrivateKey: string, password: string) => Promise<string>;
  rpcClient?: RpcClient;
  sleep?: (delayMs: number) => Promise<void>;
  now?: () => number;
  zeroizer?: (bytes: Uint8Array) => void;
}>;

export class TransactionService {
  private readonly confirmationTimeoutMs: number;
  private readonly sendRetryBaseDelayMs: number;
  private readonly sendRetryMaxDelayMs: number;
  private readonly decryptPrivateKey: (encryptedPrivateKey: string, password: string) => Promise<string>;
  private readonly rpcClient: RpcClient;
  private readonly sleep: (delayMs: number) => Promise<void>;
  private readonly now: () => number;
  private readonly zeroizer: (bytes: Uint8Array) => void;

  public constructor(params?: TransactionServiceParams) {
    const rpcUrl = params?.rpcUrl ?? DEFAULT_RPC_URL;

    this.confirmationTimeoutMs = params?.confirmationTimeoutMs ?? DEFAULT_CONFIRMATION_TIMEOUT_MS;
    this.sendRetryBaseDelayMs = params?.sendRetryBaseDelayMs ?? SEND_RETRY_BASE_DELAY_MS;
    this.sendRetryMaxDelayMs = params?.sendRetryMaxDelayMs ?? SEND_RETRY_MAX_DELAY_MS;
    this.decryptPrivateKey = params?.decryptPrivateKey ?? ipc.crypto.decrypt;
    this.rpcClient = params?.rpcClient ?? (createSolanaRpc(rpcUrl) as unknown as RpcClient);
    this.sleep = params?.sleep ?? TransactionService.sleep;
    this.now = params?.now ?? Date.now;
    this.zeroizer = params?.zeroizer ?? TransactionService.zero;
  }

  public async signAndSend(
    transactionBase64: string,
    encryptedPrivateKey: string,
    password: string,
  ): Promise<SendTransactionResult> {
    let signature: TxSignature | null = null;

    try {
      const decryptedPrivateKeyBase64 = await this.decryptPrivateKey(encryptedPrivateKey, password);
      const privateKeyBytes = TransactionService.decodeBase64(decryptedPrivateKeyBase64);

      if (privateKeyBytes.length !== PRIVATE_KEY_LENGTH_BYTES) {
        throw new Error('Encrypted key payload must contain a 32-byte private key.');
      }

      try {
        const signer = await createKeyPairSignerFromPrivateKeyBytes(privateKeyBytes, false);
        const unsignedTransactionBytes = TransactionService.decodeBase64(transactionBase64);
        const unsignedTransaction = getTransactionDecoder().decode(unsignedTransactionBytes);
        const signedTransaction = await signTransaction([signer.keyPair], unsignedTransaction);
        const signedTransactionBytes = Uint8Array.from(getTransactionEncoder().encode(signedTransaction));
        const signedTransactionBase64 = TransactionService.encodeBase64(signedTransactionBytes);

        const rawSignature = await this.sendWithRetry(signedTransactionBase64);
        signature = new TxSignature(rawSignature);
      } finally {
        this.zeroizer(privateKeyBytes);
      }

      const confirmationStatus = await this.waitForConfirmation(
        signature.value as Signature,
        this.confirmationTimeoutMs,
      );

      if (confirmationStatus === 'failed') {
        return {
          success: false,
          signature,
          error: 'Transaction failed on-chain.',
          confirmed: false,
        };
      }

      return {
        success: true,
        signature,
        error: null,
        confirmed: confirmationStatus === 'confirmed',
      };
    } catch (error) {
      return {
        success: false,
        signature,
        error: TransactionService.sanitizeError(error),
        confirmed: false,
      };
    }
  }

  public async waitForConfirmation(signature: Signature, timeoutMs: number): Promise<ConfirmationStatus> {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return 'timeout';
    }

    const deadline = this.now() + timeoutMs;
    let delayMs = CONFIRMATION_BASE_DELAY_MS;

    while (this.now() <= deadline) {
      const response = await this.rpcClient
        .getSignatureStatuses([signature], {
          searchTransactionHistory: true,
        })
        .send();

      const status = TransactionService.extractStatus(response);
      if (status?.err !== null && status?.err !== undefined) {
        return 'failed';
      }

      const confirmation = status?.confirmationStatus;
      if (confirmation === 'confirmed' || confirmation === 'finalized') {
        return 'confirmed';
      }

      const remainingMs = deadline - this.now();
      if (remainingMs <= 0) {
        break;
      }

      const waitMs = Math.min(delayMs, CONFIRMATION_MAX_DELAY_MS, remainingMs);
      await this.sleep(waitMs);
      delayMs = Math.min(delayMs * 2, CONFIRMATION_MAX_DELAY_MS);
    }

    return 'timeout';
  }

  private async sendWithRetry(signedTransactionBase64: string): Promise<string> {
    return Retry.execute(
      async () => {
        const signature = await this.rpcClient
          .sendTransaction(signedTransactionBase64, {
            encoding: 'base64',
            skipPreflight: false,
            preflightCommitment: 'confirmed',
          })
          .send();

        return String(signature);
      },
      {
        retries: SEND_RETRIES,
        baseDelayMs: this.sendRetryBaseDelayMs,
        maxDelayMs: this.sendRetryMaxDelayMs,
        shouldRetry: (error) => {
          return TransactionService.shouldRetrySendError(error);
        },
      },
    );
  }

  private static extractStatus(response: unknown): SignatureStatusValue | null {
    const direct = TransactionService.readStatusesArray(response);
    if (direct) {
      return direct[0] ?? null;
    }

    const rootObject = TransactionService.readRecord(response);
    if (!rootObject) {
      return null;
    }

    const nestedResult = TransactionService.readRecord(rootObject.result);
    const nested = TransactionService.readStatusesArray(nestedResult);

    return nested?.[0] ?? null;
  }

  private static readStatusesArray(value: unknown): ReadonlyArray<SignatureStatusValue | null> | null {
    const payload = TransactionService.readRecord(value) as SignatureStatusesPayload | null;
    if (!payload || !Array.isArray(payload.value)) {
      return null;
    }

    return payload.value;
  }

  private static shouldRetrySendError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return true;
    }

    const message = error.message.toLowerCase();

    const isPreflightFailure =
      message.includes('preflight') ||
      message.includes('simulation failed') ||
      message.includes('insufficient funds') ||
      message.includes('custom program error') ||
      message.includes('signature verification failure') ||
      message.includes('blockhash not found');

    if (isPreflightFailure) {
      return false;
    }

    return (
      message.includes('timeout') ||
      message.includes('network') ||
      message.includes('fetch') ||
      message.includes('http 5') ||
      message.includes('http 429') ||
      message.includes('rate limit')
    );
  }

  private static sanitizeError(error: unknown): string {
    if (!(error instanceof Error)) {
      return 'Transaction signing and sending failed.';
    }

    const message = error.message.toLowerCase();

    if (message.includes('failed to decrypt payload') || message.includes('invalid password')) {
      return 'Failed to decrypt private key.';
    }

    if (message.includes('32-byte private key')) {
      return 'Private key payload is invalid.';
    }

    if (message.includes('base64') || message.includes('decode')) {
      return 'Transaction payload is invalid.';
    }

    if (message.includes('preflight') || message.includes('simulation failed')) {
      return 'Transaction was rejected during preflight simulation.';
    }

    if (
      message.includes('timeout') ||
      message.includes('network') ||
      message.includes('fetch') ||
      message.includes('http')
    ) {
      return 'Network error while sending transaction.';
    }

    return 'Transaction signing and sending failed.';
  }

  private static decodeBase64(value: string): Uint8Array {
    try {
      if (typeof globalThis.atob === 'function') {
        const binary = globalThis.atob(value);
        return Uint8Array.from(binary, (char) => char.charCodeAt(0));
      }

      if (typeof Buffer !== 'undefined') {
        return Uint8Array.from(Buffer.from(value, 'base64'));
      }

      throw new Error('Base64 decoder is unavailable.');
    } catch {
      throw new Error('Invalid base64 payload.');
    }
  }

  private static encodeBase64(bytes: Uint8Array | ReadonlyUint8Array): string {
    if (typeof globalThis.btoa === 'function') {
      let binary = '';
      for (const byte of bytes) {
        binary += String.fromCharCode(byte);
      }

      return globalThis.btoa(binary);
    }

    if (typeof Buffer !== 'undefined') {
      return Buffer.from(bytes).toString('base64');
    }

    throw new Error('Base64 encoder is unavailable.');
  }

  private static readRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    return value as Record<string, unknown>;
  }

  private static async sleep(delayMs: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, delayMs);
    });
  }

  private static zero(bytes: Uint8Array): void {
    bytes.fill(0);
  }
}

export { TransactionService as TransactionClient };
