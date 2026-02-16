import { describe, expect, it } from 'vitest';

import { Precision } from './Precision';

describe('Precision', () => {
  it('converts human amount to raw amount', () => {
    expect(Precision.toRawAmount('1.25', 6)).toBe('1250000');
  });

  it('converts raw amount to human amount', () => {
    expect(Precision.toHumanAmount('1250000', 6)).toBe('1.25');
  });

  it('throws when raw amount is not integer', () => {
    expect(() => Precision.toRawAmount('0.0000001', 6)).toThrowError('Raw token amount must be an integer.');
  });
});
