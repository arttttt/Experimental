import { describe, expect, it } from 'vitest';

import { Retry } from './Retry';

describe('Retry', () => {
  it('retries operation until success', async () => {
    let attempts = 0;

    const result = await Retry.execute(
      async () => {
        attempts += 1;

        if (attempts < 3) {
          throw new Error('temporary');
        }

        return 'ok';
      },
      {
        retries: 3,
        baseDelayMs: 1,
      },
    );

    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('throws when retries are exhausted', async () => {
    await expect(
      Retry.execute(
        async () => {
          throw new Error('always fails');
        },
        {
          retries: 1,
          baseDelayMs: 1,
        },
      ),
    ).rejects.toThrowError('always fails');
  });
});
