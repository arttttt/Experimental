import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateSigner = vi.fn();
const mockDecodeTransaction = vi.fn();
const mockSignTransaction = vi.fn();
const mockEncodeTransaction = vi.fn();

vi.mock('@solana/kit', () => {
  return {
    createKeyPairSignerFromPrivateKeyBytes: (...args: unknown[]) => mockCreateSigner(...args),
    createSolanaRpc: vi.fn(),
    getTransactionDecoder: () => ({
      decode: (...args: unknown[]) => mockDecodeTransaction(...args),
    }),
    getTransactionEncoder: () => ({
      encode: (...args: unknown[]) => mockEncodeTransaction(...args),
    }),
    signTransaction: (...args: unknown[]) => mockSignTransaction(...args),
  };
});

import { TransactionService } from './TransactionClient';

const VALID_SIGNATURE = '1111111111111111111111111111111111111111111111111111111111111111';
const PRIVATE_KEY_32 = Uint8Array.from(Array.from({ length: 32 }, (_, index) => index + 1));

describe('TransactionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockCreateSigner.mockResolvedValue({
      keyPair: {
        privateKey: {},
        publicKey: {},
      },
    });
    mockDecodeTransaction.mockReturnValue({ unsigned: true });
    mockSignTransaction.mockResolvedValue({ signed: true });
    mockEncodeTransaction.mockReturnValue(Uint8Array.from([1, 2, 3]));
  });

  it('signs, sends and confirms transaction', async () => {
    const service = new TransactionService({
      decryptPrivateKey: vi.fn().mockResolvedValue(toBase64(PRIVATE_KEY_32)),
      rpcClient: createRpcMock({
        sendResults: [VALID_SIGNATURE],
        statusResults: [{ value: [{ confirmationStatus: 'confirmed', err: null }] }],
      }),
    });

    const result = await service.signAndSend('AQID', 'encrypted', 'password');

    expect(result.success).toBe(true);
    expect(result.confirmed).toBe(true);
    expect(result.error).toBeNull();
    expect(result.signature?.value).toBe(VALID_SIGNATURE);
  });

  it('returns timeout status from confirmation polling', async () => {
    let nowMs = 0;
    const service = new TransactionService({
      decryptPrivateKey: vi.fn().mockResolvedValue(toBase64(PRIVATE_KEY_32)),
      confirmationTimeoutMs: 3_000,
      now: () => nowMs,
      sleep: async (delayMs) => {
        nowMs += delayMs;
      },
      rpcClient: createRpcMock({
        sendResults: [VALID_SIGNATURE],
        statusResults: [
          { value: [null] },
          { value: [null] },
          { value: [null] },
          { value: [null] },
        ],
      }),
    });

    const result = await service.signAndSend('AQID', 'encrypted', 'password');

    expect(result.success).toBe(true);
    expect(result.confirmed).toBe(false);
    expect(result.error).toBeNull();
    expect(result.signature?.value).toBe(VALID_SIGNATURE);
  });

  it('returns failed result when chain reports transaction error', async () => {
    const service = new TransactionService({
      decryptPrivateKey: vi.fn().mockResolvedValue(toBase64(PRIVATE_KEY_32)),
      rpcClient: createRpcMock({
        sendResults: [VALID_SIGNATURE],
        statusResults: [{ value: [{ confirmationStatus: 'confirmed', err: { InstructionError: [0, 'x'] } }] }],
      }),
    });

    const result = await service.signAndSend('AQID', 'encrypted', 'password');

    expect(result.success).toBe(false);
    expect(result.confirmed).toBe(false);
    expect(result.error).toBe('Transaction failed on-chain.');
    expect(result.signature?.value).toBe(VALID_SIGNATURE);
  });

  it('zeroizes private key buffer after signing', async () => {
    let observed: Uint8Array | null = null;

    const service = new TransactionService({
      decryptPrivateKey: vi.fn().mockResolvedValue(toBase64(PRIVATE_KEY_32)),
      zeroizer: (bytes) => {
        observed = bytes;
        bytes.fill(0);
      },
      rpcClient: createRpcMock({
        sendResults: [VALID_SIGNATURE],
        statusResults: [{ value: [{ confirmationStatus: 'confirmed', err: null }] }],
      }),
    });

    await service.signAndSend('AQID', 'encrypted', 'password');

    expect(observed).not.toBeNull();
    expect(Array.from(observed ?? [])).toEqual(new Array(32).fill(0));
  });

  it('retries sendTransaction on network errors', async () => {
    const sendError = new Error('Network request failed');
    const service = new TransactionService({
      decryptPrivateKey: vi.fn().mockResolvedValue(toBase64(PRIVATE_KEY_32)),
      sendRetryBaseDelayMs: 1,
      sendRetryMaxDelayMs: 2,
      rpcClient: createRpcMock({
        sendResults: [sendError, sendError, VALID_SIGNATURE],
        statusResults: [{ value: [{ confirmationStatus: 'confirmed', err: null }] }],
      }),
    });

    const result = await service.signAndSend('AQID', 'encrypted', 'password');

    expect(result.success).toBe(true);
    expect(result.signature?.value).toBe(VALID_SIGNATURE);
  });

  it('sanitizes decrypt errors', async () => {
    const service = new TransactionService({
      decryptPrivateKey: vi
        .fn()
        .mockRejectedValue(new Error('Failed to decrypt payload. Invalid password or corrupted data.')),
      rpcClient: createRpcMock({
        sendResults: [VALID_SIGNATURE],
        statusResults: [{ value: [{ confirmationStatus: 'confirmed', err: null }] }],
      }),
    });

    const result = await service.signAndSend('AQID', 'encrypted', 'wrong-password');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Failed to decrypt private key.');
    expect(result.signature).toBeNull();
  });

  it('sanitizes preflight errors without retrying', async () => {
    const sendTransaction = vi.fn(() => {
      return {
        send: vi.fn().mockRejectedValue(new Error('Preflight simulation failed: insufficient funds')),
      };
    });

    const service = new TransactionService({
      decryptPrivateKey: vi.fn().mockResolvedValue(toBase64(PRIVATE_KEY_32)),
      rpcClient: {
        sendTransaction,
        getSignatureStatuses: vi.fn(() => ({
          send: vi.fn().mockResolvedValue({ value: [null] }),
        })),
      },
      sendRetryBaseDelayMs: 1,
      sendRetryMaxDelayMs: 2,
    });

    const result = await service.signAndSend('AQID', 'encrypted', 'password');

    expect(sendTransaction).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Transaction was rejected during preflight simulation.');
  });
});

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function createRpcMock(params: {
  sendResults: Array<string | Error>;
  statusResults: unknown[];
}) {
  const sendResults = [...params.sendResults];
  const statusResults = [...params.statusResults];

  return {
    sendTransaction: vi.fn(() => {
      const next = sendResults.shift();

      return {
        send: vi.fn().mockImplementation(async () => {
          if (next instanceof Error) {
            throw next;
          }

          return next ?? VALID_SIGNATURE;
        }),
      };
    }),
    getSignatureStatuses: vi.fn(() => {
      const next = statusResults.shift() ?? { value: [null] };

      return {
        send: vi.fn().mockResolvedValue(next),
      };
    }),
  };
}
