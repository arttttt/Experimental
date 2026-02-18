import { describe, expect, it } from 'vitest';

import { KeyEncryptionService } from './KeyEncryption';

describe('KeyEncryptionService', () => {
  const service = new KeyEncryptionService();

  it('encrypts and decrypts a payload roundtrip', async () => {
    const plaintext = 'seed phrase example with enough entropy';
    const password = 'correct horse battery staple';

    const encrypted = await service.encrypt(plaintext, password);
    const decrypted = await service.decrypt(encrypted, password);

    expect(encrypted).not.toBe(plaintext);
    expect(decrypted).toBe(plaintext);
  });

  it('fails decryption when password is wrong', async () => {
    const encrypted = await service.encrypt('private-key-value', 'right-password');

    await expect(service.decrypt(encrypted, 'wrong-password')).rejects.toThrowError(
      'Failed to decrypt payload. Invalid password or corrupted data.',
    );
  });

  it('produces different ciphertext for different passwords', async () => {
    const plaintext = 'same-secret';

    const encryptedWithPasswordA = await service.encrypt(plaintext, 'password-a');
    const encryptedWithPasswordB = await service.encrypt(plaintext, 'password-b');

    expect(encryptedWithPasswordA).not.toBe(encryptedWithPasswordB);
  });

  it('produces different ciphertext for same plaintext and password', async () => {
    const plaintext = 'same-secret';
    const password = 'repeat-password';

    const firstEncrypted = await service.encrypt(plaintext, password);
    const secondEncrypted = await service.encrypt(plaintext, password);

    expect(firstEncrypted).not.toBe(secondEncrypted);
  });

  it('detects encrypted format and rejects raw base64', async () => {
    const encrypted = await service.encrypt('wallet-private-key', 'strong-password');
    const rawBase64 = Buffer.from('wallet-private-key', 'utf8').toString('base64');

    expect(service.isEncrypted(encrypted)).toBe(true);
    expect(service.isEncrypted(rawBase64)).toBe(false);
  });
});
