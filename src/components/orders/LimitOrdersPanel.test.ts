import { describe, expect, it } from 'vitest';

import {
  isPositiveIntegerString,
  prettyDate,
  shortText,
} from '@/components/orders/LimitOrdersPanel';

describe('LimitOrdersPanel helpers', () => {
  it('accepts positive integer strings', () => {
    expect(isPositiveIntegerString('1')).toBe(true);
    expect(isPositiveIntegerString('900000')).toBe(true);
    expect(isPositiveIntegerString('0009')).toBe(true);
  });

  it('rejects zero, decimals, negatives, and non-numbers', () => {
    expect(isPositiveIntegerString('0')).toBe(false);
    expect(isPositiveIntegerString('0000')).toBe(false);
    expect(isPositiveIntegerString('-1')).toBe(false);
    expect(isPositiveIntegerString('1.2')).toBe(false);
    expect(isPositiveIntegerString('abc')).toBe(false);
  });

  it('formats unix-seconds timestamps into readable date', () => {
    const formatted = prettyDate('1737075600');
    expect(formatted).not.toBe('1737075600');
    expect(formatted).not.toBe('-');
  });

  it('returns fallback for empty date', () => {
    expect(prettyDate()).toBe('-');
    expect(prettyDate('')).toBe('-');
  });

  it('shortens long text while preserving prefixes and suffixes', () => {
    const original = '1234567890abcdefghij';
    const shortened = shortText(original, 4);
    expect(shortened).toBe('1234...ghij');
  });
});
