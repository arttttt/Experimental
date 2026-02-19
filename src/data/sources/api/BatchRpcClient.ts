type JsonRpcId = number;

export type BatchRpcRequest = Readonly<{
  id: JsonRpcId;
  method: string;
  params?: unknown[];
}>;

interface JsonRpcErrorPayload {
  code: number;
  message: string;
  data?: unknown;
}

interface JsonRpcSuccessResponse {
  id: JsonRpcId;
  result: unknown;
}

interface JsonRpcErrorResponse {
  id: JsonRpcId;
  error: JsonRpcErrorPayload;
}

type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

type JsonRpcPayloadRequest = Readonly<{
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params: unknown[];
}>;

export class BatchRpcClient {
  private readonly rpcUrl: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly baseDelayMs: number;

  public constructor(params?: {
    rpcUrl?: string;
    timeoutMs?: number;
    retries?: number;
    baseDelayMs?: number;
  }) {
    this.rpcUrl = params?.rpcUrl ?? 'https://api.mainnet-beta.solana.com';
    this.timeoutMs = params?.timeoutMs ?? 8_000;
    this.retries = params?.retries ?? 2;
    this.baseDelayMs = params?.baseDelayMs ?? 250;
  }

  public async execute(requests: readonly BatchRpcRequest[]): Promise<Map<JsonRpcId, unknown>> {
    const pending = new Map<JsonRpcId, BatchRpcRequest>(requests.map((request) => [request.id, request]));
    const results = new Map<JsonRpcId, unknown>();

    for (let attempt = 1; attempt <= this.retries + 1; attempt += 1) {
      if (pending.size === 0) {
        return results;
      }

      const payload: JsonRpcPayloadRequest[] = Array.from(pending.values()).map((request) => ({
        jsonrpc: '2.0',
        id: request.id,
        method: request.method,
        params: request.params ?? [],
      }));

      let response: JsonRpcResponse[];

      try {
        response = await this.postBatch(payload);
      } catch (error) {
        if (attempt > this.retries || !BatchRpcClient.shouldRetry(error)) {
          throw error;
        }

        await BatchRpcClient.sleep(this.baseDelayMs * 2 ** (attempt - 1));
        continue;
      }

      const seenIds = new Set<number>();
      const retryableIds = new Set<number>();

      for (const item of response) {
        seenIds.add(item.id);

        if ('error' in item) {
          retryableIds.add(item.id);
          continue;
        }

        results.set(item.id, item.result);
        pending.delete(item.id);
      }

      for (const id of pending.keys()) {
        if (!seenIds.has(id)) {
          retryableIds.add(id);
        }
      }

      if (pending.size === 0) {
        return results;
      }

      if (attempt > this.retries) {
        throw new Error(`RPC batch failed for request ids: ${Array.from(pending.keys()).join(', ')}`);
      }

      for (const id of pending.keys()) {
        if (!retryableIds.has(id)) {
          pending.delete(id);
        }
      }

      if (pending.size === 0) {
        return results;
      }

      await BatchRpcClient.sleep(this.baseDelayMs * 2 ** (attempt - 1));
    }

    return results;
  }

  private async postBatch(
    payload: ReadonlyArray<JsonRpcPayloadRequest>,
  ): Promise<JsonRpcResponse[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const json = (await response.json()) as unknown;
      if (!Array.isArray(json)) {
        throw new Error('Invalid batch RPC response');
      }

      return json.filter(BatchRpcClient.isJsonRpcResponse);
    } finally {
      clearTimeout(timer);
    }
  }

  private static shouldRetry(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return true;
    }

    const message = error.message.toLowerCase();
    return (
      message.includes('429') ||
      message.includes('rate') ||
      message.includes('timeout') ||
      message.includes('network') ||
      message.includes('fetch')
    );
  }

  private static isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
    if (!value || typeof value !== 'object') {
      return false;
    }

    if (!('id' in value) || typeof value.id !== 'number') {
      return false;
    }

    return 'result' in value || 'error' in value;
  }

  private static async sleep(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
