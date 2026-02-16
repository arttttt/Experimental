import { describe, expect, it } from 'vitest';

import { SlippagePolicy } from './SlippagePolicy';

describe('SlippagePolicy', () => {
  it('accepts slippage within bounds', () => {
    expect(SlippagePolicy.ensureValidBps(50)).toBe(50);
  });

  it('rejects non-integer slippage', () => {
    expect(() => SlippagePolicy.ensureValidBps(12.5)).toThrowError('Slippage bps must be an integer.');
  });

  it('converts bps to percent', () => {
    expect(SlippagePolicy.bpsToPercent(125)).toBe(1.25);
  });
});
