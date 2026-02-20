import { describe, expect, it } from 'vitest';

import { ipc } from './ipc';

const WALLET_CRYPTO_UNAVAILABLE_ERROR =
  'Wallet crypto API is unavailable. Use the Electron app shell to access secure key operations.';

describe('ipc.crypto', () => {
  it('throws a clear error when wallet crypto bridge is unavailable', async () => {
    Object.defineProperty(globalThis, 'window', {
      value: {},
      configurable: true,
      writable: true,
    });

    await expect(ipc.crypto.encrypt('secret', 'password')).rejects.toThrowError(
      WALLET_CRYPTO_UNAVAILABLE_ERROR,
    );
    await expect(ipc.crypto.decrypt('encrypted', 'password')).rejects.toThrowError(
      WALLET_CRYPTO_UNAVAILABLE_ERROR,
    );
  });

  it('delegates to preload wallet crypto bridge when present', async () => {
    Object.defineProperty(globalThis, 'window', {
      value: {
        walletCrypto: {
          encrypt: async (plaintext: string, password: string) => `${plaintext}:${password}`,
          decrypt: async (encryptedBase64: string, password: string) => `${encryptedBase64}:${password}`,
        },
      },
      configurable: true,
      writable: true,
    });

    await expect(ipc.crypto.encrypt('a', 'b')).resolves.toBe('a:b');
    await expect(ipc.crypto.decrypt('c', 'd')).resolves.toBe('c:d');
  });
});
