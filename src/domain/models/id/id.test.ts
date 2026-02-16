import { describe, expect, it } from 'vitest';

import { TokenMint, TxSignature, WalletAddress } from './index';

describe('Branded ID models', () => {
  it('creates TokenMint and compares with equals', () => {
    const left = new TokenMint('So11111111111111111111111111111111111111112');
    const right = new TokenMint('So11111111111111111111111111111111111111112');

    expect(left.equals(right)).toBe(true);
  });

  it('throws for invalid wallet address', () => {
    expect(() => new WalletAddress('not-base58')).toThrowError('WalletAddress must be a base58 string.');
  });

  it('throws for too short tx signature', () => {
    expect(() => new TxSignature('123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz')).toThrowError(
      'TxSignature length must be between 64 and 88 characters.',
    );
  });
});
