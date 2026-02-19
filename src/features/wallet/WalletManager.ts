import {
  createKeyPairSignerFromPrivateKeyBytes,
  type KeyPairSigner,
} from '@solana/kit';
import bs58 from 'bs58';
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';

import { WalletAddress } from '@/domain/models/id';
import { ipc } from '@/lib/ipc';

const DERIVATION_PATH = "m/44'/501'/0'/0'";
const MAX_INPUT_BYTES = 512;
const PRIVATE_KEY_LENGTH = 32;
const SECRET_KEY_LENGTH = 64;

export type ValidateMnemonicResult = Readonly<{
  valid: boolean;
  address: WalletAddress | null;
  error?: string;
}>;

export type ValidatePrivateKeyResult = Readonly<{
  valid: boolean;
  address: WalletAddress | null;
  error?: string;
}>;

export type GeneratedWallet = Readonly<{
  address: WalletAddress;
  encryptedKey: string;
  mnemonic: string;
}>;

export type ImportedWallet = Readonly<{
  address: WalletAddress;
  encryptedKey: string;
}>;

export class WalletManager {
  public async generateWallet(password: string): Promise<GeneratedWallet> {
    WalletManager.assertPassword(password);

    const mnemonic = bip39.generateMnemonic(128);
    const normalizedMnemonic = WalletManager.normalizeMnemonic(mnemonic);
    const privateKeyBytes = await WalletManager.derivePrivateKeyFromMnemonic(normalizedMnemonic);

    try {
      const wallet = await WalletManager.createWalletFromPrivateKey(privateKeyBytes, password);
      return { ...wallet, mnemonic: normalizedMnemonic };
    } finally {
      WalletManager.zero(privateKeyBytes);
    }
  }

  public async importFromSeed(mnemonic: string, password: string): Promise<ImportedWallet> {
    WalletManager.assertPassword(password);
    WalletManager.assertInputSize('mnemonic', mnemonic);

    const normalizedMnemonic = WalletManager.normalizeMnemonic(mnemonic);
    if (!bip39.validateMnemonic(normalizedMnemonic)) {
      throw new Error('Invalid mnemonic phrase.');
    }

    const privateKeyBytes = await WalletManager.derivePrivateKeyFromMnemonic(normalizedMnemonic);

    try {
      return await WalletManager.createWalletFromPrivateKey(privateKeyBytes, password);
    } finally {
      WalletManager.zero(privateKeyBytes);
    }
  }

  public async importFromPrivateKey(
    privateKeyBase58or64: string,
    password: string,
  ): Promise<ImportedWallet> {
    WalletManager.assertPassword(password);
    WalletManager.assertInputSize('private key', privateKeyBase58or64);

    const decoded = WalletManager.decodePrivateKey(privateKeyBase58or64);
    const normalizedPrivateKey = WalletManager.normalizePrivateKey(decoded);

    try {
      return await WalletManager.createWalletFromPrivateKey(normalizedPrivateKey, password);
    } finally {
      WalletManager.zero(decoded);
      WalletManager.zero(normalizedPrivateKey);
    }
  }

  public async validateMnemonic(mnemonic: string): Promise<ValidateMnemonicResult> {
    try {
      WalletManager.assertInputSize('mnemonic', mnemonic);

      const normalizedMnemonic = WalletManager.normalizeMnemonic(mnemonic);
      if (!bip39.validateMnemonic(normalizedMnemonic)) {
        return {
          valid: false,
          address: null,
          error: 'Invalid mnemonic phrase.',
        };
      }

      const privateKeyBytes = await WalletManager.derivePrivateKeyFromMnemonic(normalizedMnemonic);

      try {
        const signer = await createKeyPairSignerFromPrivateKeyBytes(privateKeyBytes, false);
        return {
          valid: true,
          address: new WalletAddress(String(signer.address)),
        };
      } finally {
        WalletManager.zero(privateKeyBytes);
      }
    } catch (error) {
      return {
        valid: false,
        address: null,
        error: WalletManager.getErrorMessage(error),
      };
    }
  }

  public async validatePrivateKey(privateKey: string): Promise<ValidatePrivateKeyResult> {
    try {
      WalletManager.assertInputSize('private key', privateKey);

      const decoded = WalletManager.decodePrivateKey(privateKey);
      const normalizedPrivateKey = WalletManager.normalizePrivateKey(decoded);

      try {
        const signer = await createKeyPairSignerFromPrivateKeyBytes(normalizedPrivateKey, false);
        return {
          valid: true,
          address: new WalletAddress(String(signer.address)),
        };
      } finally {
        WalletManager.zero(decoded);
        WalletManager.zero(normalizedPrivateKey);
      }
    } catch (error) {
      return {
        valid: false,
        address: null,
        error: WalletManager.getErrorMessage(error),
      };
    }
  }

  public async getSignerFromEncryptedKey(
    encryptedKey: string,
    password: string,
  ): Promise<KeyPairSigner> {
    WalletManager.assertPassword(password);
    WalletManager.assertInputSize('encrypted key', encryptedKey);

    const decrypted = await ipc.crypto.decrypt(encryptedKey, password);
    const privateKeyBytes = WalletManager.decodeBase64(decrypted);

    if (privateKeyBytes.length !== PRIVATE_KEY_LENGTH) {
      WalletManager.zero(privateKeyBytes);
      throw new Error('Encrypted key payload must contain a 32-byte private key.');
    }

    const signerInput = Uint8Array.from(privateKeyBytes);
    WalletManager.zero(privateKeyBytes);

    return createKeyPairSignerFromPrivateKeyBytes(signerInput, false);
  }

  public async getAddressFromEncryptedKey(encryptedKey: string, password: string): Promise<WalletAddress> {
    WalletManager.assertPassword(password);
    WalletManager.assertInputSize('encrypted key', encryptedKey);

    const decrypted = await ipc.crypto.decrypt(encryptedKey, password);
    const privateKeyBytes = WalletManager.decodeBase64(decrypted);

    if (privateKeyBytes.length !== PRIVATE_KEY_LENGTH) {
      WalletManager.zero(privateKeyBytes);
      throw new Error('Encrypted key payload must contain a 32-byte private key.');
    }

    try {
      const signer = await createKeyPairSignerFromPrivateKeyBytes(privateKeyBytes, false);
      return new WalletAddress(String(signer.address));
    } finally {
      WalletManager.zero(privateKeyBytes);
    }
  }

  private static async derivePrivateKeyFromMnemonic(mnemonic: string): Promise<Uint8Array> {
    const seedBytes = await bip39.mnemonicToSeed(mnemonic);

    try {
      const seedHex = WalletManager.bytesToHex(seedBytes);
      const derived = derivePath(DERIVATION_PATH, seedHex);
      return new Uint8Array(derived.key);
    } finally {
      WalletManager.zero(seedBytes);
    }
  }

  private static decodePrivateKey(privateKey: string): Uint8Array {
    const normalized = privateKey.trim();
    if (normalized.length === 0) {
      throw new Error('Private key must not be empty.');
    }

    try {
      return Uint8Array.from(bs58.decode(normalized));
    } catch {
      try {
        return WalletManager.decodeBase64(normalized);
      } catch {
        throw new Error('Private key has invalid encoding. Expected base58 or base64.');
      }
    }
  }

  private static async createWalletFromPrivateKey(
    privateKeyBytes: Uint8Array,
    password: string,
  ): Promise<ImportedWallet> {
    const encodedPrivateKey = WalletManager.encodeBase64(privateKeyBytes);
    const encryptedKey = await ipc.crypto.encrypt(encodedPrivateKey, password);
    const signerInput = Uint8Array.from(privateKeyBytes);

    try {
      const signer = await createKeyPairSignerFromPrivateKeyBytes(signerInput, false);
      const address = new WalletAddress(String(signer.address));

      return {
        address,
        encryptedKey,
      };
    } finally {
      WalletManager.zero(signerInput);
    }
  }

  private static normalizePrivateKey(decoded: Uint8Array): Uint8Array {
    if (decoded.length === PRIVATE_KEY_LENGTH) {
      return Uint8Array.from(decoded);
    }

    if (decoded.length === SECRET_KEY_LENGTH) {
      return Uint8Array.from(decoded.slice(0, PRIVATE_KEY_LENGTH));
    }

    throw new Error('Private key must decode to 32 or 64 bytes.');
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

  private static encodeBase64(bytes: Uint8Array): string {
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

  private static normalizeMnemonic(mnemonic: string): string {
    return mnemonic
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0)
      .map((word) => word.toLowerCase())
      .join(' ');
  }

  private static assertPassword(password: string): void {
    WalletManager.assertInputSize('password', password);

    if (password.length === 0) {
      throw new Error('Password must not be empty.');
    }
  }

  private static assertInputSize(fieldName: string, input: string): void {
    const size = new TextEncoder().encode(input).byteLength;
    if (size > MAX_INPUT_BYTES) {
      throw new Error(`${fieldName} is too large.`);
    }
  }

  private static bytesToHex(bytes: Uint8Array): string {
    let hex = '';
    for (const byte of bytes) {
      hex += byte.toString(16).padStart(2, '0');
    }
    return hex;
  }

  private static zero(bytes: Uint8Array): void {
    bytes.fill(0);
  }

  private static getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return 'Unexpected wallet validation error.';
  }
}
