import {
  createKeyPairSignerFromPrivateKeyBytes,
} from '@solana/kit';
import { bytesToHex } from '@noble/hashes/utils';
import bs58 from 'bs58';
import * as bip39 from 'bip39';
import { beforeAll, describe, expect, it } from 'vitest';

import { derivePath } from './slip0010';

import { KeyEncryptionService } from '@/infrastructure/internal/crypto';

import { WalletManager } from './WalletManager';

const DERIVATION_PATH = "m/44'/501'/0'/0'";
const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const TEST_PASSWORD = 'test-password-123';

describe('WalletManager', () => {
  beforeAll(() => {
    const encryptionService = new KeyEncryptionService();
    const walletCrypto = {
      encrypt: (plaintext: string, password: string) => encryptionService.encrypt(plaintext, password),
      decrypt: (encryptedBase64: string, password: string) =>
        encryptionService.decrypt(encryptedBase64, password),
    };

    if (typeof window !== 'undefined') {
      window.walletCrypto = walletCrypto;
      return;
    }

    Object.defineProperty(globalThis, 'window', {
      value: {
        walletCrypto,
      },
      configurable: true,
      writable: true,
    });
  });

  it('generates wallet with valid address and mnemonic', async () => {
    const manager = new WalletManager();

    const generated = await manager.generateWallet(TEST_PASSWORD);

    expect(generated.address.value).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(generated.mnemonic.split(' ')).toHaveLength(12);
    expect(generated.encryptedKey.length).toBeGreaterThan(0);
  });

  it('imports wallet from mnemonic and returns deterministic address', async () => {
    const manager = new WalletManager();

    const imported = await manager.importFromSeed(TEST_MNEMONIC, TEST_PASSWORD);
    const validated = await manager.validateMnemonic(TEST_MNEMONIC);

    expect(validated.valid).toBe(true);
    expect(validated.address?.value).toBe(imported.address.value);
  });

  it('imports base58 private key', async () => {
    const manager = new WalletManager();
    const privateKey = await derivePrivateKey(TEST_MNEMONIC);
    const base58 = bs58.encode(privateKey);

    const imported = await manager.importFromPrivateKey(base58, TEST_PASSWORD);
    const expectedAddress = await deriveAddressFromPrivateKey(privateKey);

    expect(imported.address.value).toBe(expectedAddress);
  });

  it('imports base64 private key for 32-byte and 64-byte variants', async () => {
    const manager = new WalletManager();
    const privateKey = await derivePrivateKey(TEST_MNEMONIC);

    const privateKeyBase64 = Buffer.from(privateKey).toString('base64');
    const importedFrom32 = await manager.importFromPrivateKey(privateKeyBase64, TEST_PASSWORD);

    const extended64 = Uint8Array.from([...privateKey, ...privateKey]);
    const extended64Base64 = Buffer.from(extended64).toString('base64');
    const importedFrom64 = await manager.importFromPrivateKey(extended64Base64, TEST_PASSWORD);

    expect(importedFrom32.address.value).toBe(importedFrom64.address.value);
  });

  it('rejects invalid mnemonic and private key', async () => {
    const manager = new WalletManager();

    const invalidMnemonic = await manager.validateMnemonic('not a valid mnemonic phrase');
    const invalidPrivateKey = await manager.validatePrivateKey('###');

    expect(invalidMnemonic.valid).toBe(false);
    expect(invalidPrivateKey.valid).toBe(false);
  });

  it('decrypts encrypted key and derives signer/address', async () => {
    const manager = new WalletManager();

    const imported = await manager.importFromSeed(TEST_MNEMONIC, TEST_PASSWORD);
    const signer = await manager.getSignerFromEncryptedKey(imported.encryptedKey, TEST_PASSWORD);
    const address = await manager.getAddressFromEncryptedKey(imported.encryptedKey, TEST_PASSWORD);

    expect(String(signer.address)).toBe(imported.address.value);
    expect(address.value).toBe(imported.address.value);
  });

  it('fails to decrypt signer with wrong password', async () => {
    const manager = new WalletManager();
    const imported = await manager.importFromSeed(TEST_MNEMONIC, TEST_PASSWORD);

    await expect(
      manager.getSignerFromEncryptedKey(imported.encryptedKey, 'wrong-password'),
    ).rejects.toThrowError('Failed to decrypt payload. Invalid password or corrupted data.');
  });
});

async function derivePrivateKey(mnemonic: string): Promise<Uint8Array> {
  const seed = await bip39.mnemonicToSeed(mnemonic);
  const derived = derivePath(DERIVATION_PATH, bytesToHex(new Uint8Array(seed)));
  return Uint8Array.from(derived.key);
}

async function deriveAddressFromPrivateKey(privateKey: Uint8Array): Promise<string> {
  const signer = await createKeyPairSignerFromPrivateKeyBytes(privateKey, false);
  return String(signer.address);
}
