import { randomBytes, webcrypto } from 'node:crypto';

const SALT_LENGTH_BYTES = 16;
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;
const PBKDF2_ITERATIONS = 100_000;
const AES_KEY_LENGTH_BITS = 256;
const AES_GCM_TAG_LENGTH_BITS = 128;
const MIN_ENCRYPTED_PAYLOAD_LENGTH = SALT_LENGTH_BYTES + IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES;
const ENCRYPTED_SALT_MAGIC = Buffer.from('WKY1', 'utf8');
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

type EncryptedPayload = Readonly<{
  salt: Uint8Array;
  iv: Uint8Array;
  ciphertextWithAuthTag: Uint8Array;
}>;

export class KeyEncryptionService {
  public async deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    KeyEncryptionService.ensureString(password, 'Password');
    KeyEncryptionService.ensureNonEmptyPassword(password);

    if (salt.byteLength !== SALT_LENGTH_BYTES) {
      throw new Error('Salt must be exactly 16 bytes.');
    }

    const passwordKey = await webcrypto.subtle.importKey(
      'raw',
      textEncoder.encode(password),
      {
        name: 'PBKDF2',
      },
      false,
      ['deriveKey'],
    );

    return webcrypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: PBKDF2_ITERATIONS,
        hash: 'SHA-256',
      },
      passwordKey,
      {
        name: 'AES-GCM',
        length: AES_KEY_LENGTH_BITS,
      },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  public async encrypt(plaintext: string, password: string): Promise<string> {
    KeyEncryptionService.ensureString(plaintext, 'Plaintext');
    KeyEncryptionService.ensureString(password, 'Password');
    KeyEncryptionService.ensureNonEmptyPassword(password);

    const salt = randomBytes(SALT_LENGTH_BYTES);
    ENCRYPTED_SALT_MAGIC.copy(salt, 0);
    const iv = randomBytes(IV_LENGTH_BYTES);
    const key = await this.deriveKey(password, salt);

    const encryptedArrayBuffer = await webcrypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
        tagLength: AES_GCM_TAG_LENGTH_BITS,
      },
      key,
      textEncoder.encode(plaintext),
    );

    const encryptedBytes = Buffer.from(encryptedArrayBuffer);
    const payload = Buffer.concat([salt, iv, encryptedBytes]);

    return payload.toString('base64');
  }

  public async decrypt(encryptedBase64: string, password: string): Promise<string> {
    KeyEncryptionService.ensureString(encryptedBase64, 'Encrypted payload');
    KeyEncryptionService.ensureString(password, 'Password');
    KeyEncryptionService.ensureNonEmptyPassword(password);

    if (!this.isEncrypted(encryptedBase64)) {
      throw new Error('Value is not in encrypted payload format.');
    }

    const { salt, iv, ciphertextWithAuthTag } = KeyEncryptionService.parseEncryptedPayload(encryptedBase64);
    const key = await this.deriveKey(password, salt);

    try {
      const decryptedArrayBuffer = await webcrypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv,
          tagLength: AES_GCM_TAG_LENGTH_BITS,
        },
        key,
        ciphertextWithAuthTag,
      );

      return textDecoder.decode(decryptedArrayBuffer);
    } catch {
      throw new Error('Failed to decrypt payload. Invalid password or corrupted data.');
    }
  }

  public isEncrypted(value: string): boolean {
    if (value.trim().length === 0) {
      return false;
    }

    if (!KeyEncryptionService.isBase64(value)) {
      return false;
    }

    const payload = Buffer.from(value, 'base64');
    if (payload.byteLength < MIN_ENCRYPTED_PAYLOAD_LENGTH) {
      return false;
    }

    return KeyEncryptionService.hasEncryptedSaltMagic(payload);
  }

  private static ensureNonEmptyPassword(password: string): void {
    if (password.trim().length === 0) {
      throw new Error('Password must not be empty.');
    }
  }

  private static ensureString(value: unknown, fieldName: string): void {
    if (typeof value !== 'string') {
      throw new Error(`${fieldName} must be a string.`);
    }
  }

  private static parseEncryptedPayload(encryptedBase64: string): EncryptedPayload {
    const payload = Buffer.from(encryptedBase64, 'base64');

    if (payload.byteLength < MIN_ENCRYPTED_PAYLOAD_LENGTH) {
      throw new Error('Encrypted payload is too short.');
    }

    if (!KeyEncryptionService.hasEncryptedSaltMagic(payload)) {
      throw new Error('Encrypted payload header is invalid.');
    }

    const ciphertextWithAuthTag = payload.subarray(SALT_LENGTH_BYTES + IV_LENGTH_BYTES);

    if (ciphertextWithAuthTag.byteLength < AUTH_TAG_LENGTH_BYTES) {
      throw new Error('Encrypted payload is missing authentication tag.');
    }

    return {
      salt: payload.subarray(0, SALT_LENGTH_BYTES),
      iv: payload.subarray(SALT_LENGTH_BYTES, SALT_LENGTH_BYTES + IV_LENGTH_BYTES),
      ciphertextWithAuthTag,
    };
  }

  private static hasEncryptedSaltMagic(payload: Buffer): boolean {
    return payload.subarray(0, ENCRYPTED_SALT_MAGIC.byteLength).equals(ENCRYPTED_SALT_MAGIC);
  }

  private static isBase64(value: string): boolean {
    if (value.length % 4 !== 0 || /[^A-Za-z0-9+/=]/u.test(value)) {
      return false;
    }

    try {
      const decoded = Buffer.from(value, 'base64');
      return decoded.toString('base64') === value;
    } catch {
      return false;
    }
  }
}
