export type RetryOptions = Readonly<{
  retries: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}>;

export class Retry {
  public static async execute<T>(
    operation: (attempt: number) => Promise<T>,
    options: RetryOptions,
  ): Promise<T> {
    Retry.ensureValidRetries(options.retries);

    const baseDelayMs = options.baseDelayMs ?? 250;
    const maxDelayMs = options.maxDelayMs ?? 5_000;
    const shouldRetry =
      options.shouldRetry ??
      (() => {
        return true;
      });

    for (let attempt = 1; attempt <= options.retries + 1; attempt += 1) {
      try {
        return await operation(attempt);
      } catch (error) {
        const canRetry = attempt <= options.retries && shouldRetry(error, attempt);

        if (!canRetry) {
          throw error;
        }

        const delayMs = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
        await Retry.sleep(delayMs);
      }
    }

    throw new Error('Retry failed unexpectedly.');
  }

  private static async sleep(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private static ensureValidRetries(retries: number): void {
    if (!Number.isInteger(retries) || retries < 0) {
      throw new Error('Retry count must be a non-negative integer.');
    }
  }
}
