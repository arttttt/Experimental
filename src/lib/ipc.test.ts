import { describe, expect, it } from 'vitest';

import { ipc } from './ipc';

const WALLET_CRYPTO_UNAVAILABLE_ERROR =
  'Wallet crypto API is unavailable. Use the Electron app shell to access secure key operations.';
const FILE_DIALOG_UNAVAILABLE_ERROR =
  'File dialog API is unavailable. Use the Electron app shell to access save dialogs.';
const TRADING_DB_UNAVAILABLE_ERROR =
  'Trading DB API is unavailable. Use the Electron app shell to access SQLite-backed storage.';

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

describe('ipc.db', () => {
  it('throws a clear error when trading db bridge is unavailable', async () => {
    Object.defineProperty(globalThis, 'window', {
      value: {},
      configurable: true,
      writable: true,
    });

    await expect(
      ipc.db.createTrade({
        pair: 'SOL/USDC',
        side: 'buy',
        quantity: 1,
        price: 100,
        timestamp: 1,
      }),
    ).rejects.toThrowError(TRADING_DB_UNAVAILABLE_ERROR);
  });

  it('delegates trade and snapshot operations to preload bridge when present', async () => {
    Object.defineProperty(globalThis, 'window', {
      value: {
        tradingDb: {
          createTrade: async () => ({
            id: 'trade-1',
            pair: 'SOL/USDC',
            side: 'buy',
            quantity: 1,
            price: 100,
            fee: 0.1,
            timestamp: 123,
            status: 'filled',
            createdAt: 123,
            updatedAt: 123,
          }),
          listTrades: async () => [],
          updateTrade: async () => ({
            id: 'trade-1',
            pair: 'SOL/USDC',
            side: 'buy',
            quantity: 1,
            price: 100,
            fee: 0.1,
            timestamp: 123,
            status: 'filled',
            createdAt: 123,
            updatedAt: 124,
          }),
          deleteTrade: async () => true,
          createPortfolioSnapshot: async () => ({
            id: 'snapshot-1',
            capturedAt: 123,
            totalValue: 1000,
            holdingsJson: '{"SOL":1}',
            createdAt: 123,
          }),
          listPortfolioSnapshots: async () => [],
          deletePortfolioSnapshot: async () => true,
        },
      },
      configurable: true,
      writable: true,
    });

    await expect(
      ipc.db.createTrade({
        pair: 'SOL/USDC',
        side: 'buy',
        quantity: 1,
        price: 100,
        timestamp: 123,
      }),
    ).resolves.toMatchObject({ id: 'trade-1', pair: 'SOL/USDC' });
    await expect(ipc.db.listTrades()).resolves.toEqual([]);
    await expect(ipc.db.updateTrade('trade-1', { status: 'filled' })).resolves.toMatchObject({
      id: 'trade-1',
      status: 'filled',
    });
    await expect(ipc.db.deleteTrade('trade-1')).resolves.toBe(true);

    await expect(
      ipc.db.createPortfolioSnapshot({
        capturedAt: 123,
        totalValue: 1000,
        holdings: { SOL: 1 },
      }),
    ).resolves.toMatchObject({ id: 'snapshot-1', totalValue: 1000 });
    await expect(ipc.db.listPortfolioSnapshots()).resolves.toEqual([]);
    await expect(ipc.db.deletePortfolioSnapshot('snapshot-1')).resolves.toBe(true);
  });
});

describe('ipc.fileDialog', () => {
  it('throws a clear error when file dialog bridge is unavailable', async () => {
    Object.defineProperty(globalThis, 'window', {
      value: {},
      configurable: true,
      writable: true,
    });

    await expect(
      ipc.fileDialog.saveTextFile({ defaultFileName: 'trades_2026-03-03.csv', content: 'a,b' }),
    ).rejects.toThrowError(FILE_DIALOG_UNAVAILABLE_ERROR);
  });

  it('delegates save calls to preload bridge when present', async () => {
    Object.defineProperty(globalThis, 'window', {
      value: {
        fileDialog: {
          saveTextFile: async () => ({
            saved: true,
            canceled: false,
            filePath: '/tmp/trades_2026-03-03.csv',
          }),
        },
      },
      configurable: true,
      writable: true,
    });

    await expect(
      ipc.fileDialog.saveTextFile({ defaultFileName: 'trades_2026-03-03.csv', content: 'a,b' }),
    ).resolves.toEqual({
      saved: true,
      canceled: false,
      filePath: '/tmp/trades_2026-03-03.csv',
    });
  });
});
