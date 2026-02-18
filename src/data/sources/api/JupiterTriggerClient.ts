export interface JupiterTriggerOrderParams {
  makingAmount: string;
  takingAmount: string;
  slippageBps?: string;
  expiredAt?: string;
  feeBps?: string;
}

export interface CreateTriggerOrderRequest {
  inputMint: string;
  outputMint: string;
  maker: string;
  payer: string;
  params: JupiterTriggerOrderParams;
  computeUnitPrice?: string;
  feeAccount?: string;
  wrapAndUnwrapSol?: boolean;
}

export interface CreateTriggerOrderResponse {
  transaction: string;
  requestId?: string;
}

export interface CancelTriggerOrderRequest {
  maker: string;
  order: string;
  computeUnitPrice?: string;
}

export interface CancelTriggerOrdersRequest {
  maker: string;
  orders?: string[];
  computeUnitPrice?: string;
}

export interface CancelTriggerOrderResponse {
  transaction: string;
  requestId?: string;
}

export interface CancelTriggerOrdersResponse {
  transactions: string[];
  requestId?: string;
}

export type TriggerOrderStatus = 'active' | 'history';

export interface GetTriggerOrdersRequest {
  user: string;
  orderStatus?: TriggerOrderStatus;
  page?: number;
}

export interface TriggerOrderRecord {
  readonly [key: string]: unknown;
}

export interface GetTriggerOrdersResponse {
  orders: TriggerOrderRecord[];
  hasMoreData: boolean;
}

interface JupiterApiError {
  error?: string;
  message?: string;
  code?: number;
  requestId?: string;
}

const TRIGGER_ENDPOINTS = {
  createOrder: '/createOrder',
  cancelOrder: '/cancelOrder',
  cancelOrders: '/cancelOrders',
  getTriggerOrders: '/getTriggerOrders',
} as const;

export class JupiterTriggerClientError extends Error {
  public readonly status?: number;
  public readonly code?: number;
  public readonly requestId?: string;

  public constructor(message: string, params?: { status?: number; code?: number; requestId?: string }) {
    super(message);
    this.name = 'JupiterTriggerClientError';
    this.status = params?.status;
    this.code = params?.code;
    this.requestId = params?.requestId;
  }
}

export class JupiterTriggerClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  public constructor(params?: { baseUrl?: string; timeoutMs?: number }) {
    this.baseUrl = (params?.baseUrl ?? 'https://lite-api.jup.ag/trigger/v1').replace(/\/$/, '');
    this.timeoutMs = params?.timeoutMs ?? 10_000;
  }

  public async createOrder(request: CreateTriggerOrderRequest): Promise<CreateTriggerOrderResponse> {
    JupiterTriggerClient.assertRequiredField(request.inputMint, 'inputMint');
    JupiterTriggerClient.assertRequiredField(request.outputMint, 'outputMint');
    JupiterTriggerClient.assertRequiredField(request.maker, 'maker');
    JupiterTriggerClient.assertRequiredField(request.payer, 'payer');
    JupiterTriggerClient.assertRequiredField(request.params?.makingAmount, 'params.makingAmount');
    JupiterTriggerClient.assertRequiredField(request.params?.takingAmount, 'params.takingAmount');

    const payload = await this.postJson(TRIGGER_ENDPOINTS.createOrder, request);
    const transaction =
      JupiterTriggerClient.readString(payload, 'transaction') ??
      JupiterTriggerClient.readString(payload, 'tx');
    const requestId = JupiterTriggerClient.readString(payload, 'requestId');

    return {
      transaction: JupiterTriggerClient.requireString(
        transaction,
        'Jupiter createOrder response does not contain transaction',
        requestId,
      ),
      requestId,
    };
  }

  public async cancelOrder(request: CancelTriggerOrderRequest): Promise<CancelTriggerOrderResponse> {
    JupiterTriggerClient.assertRequiredField(request.maker, 'maker');
    JupiterTriggerClient.assertRequiredField(request.order, 'order');

    const payload = await this.postJson(TRIGGER_ENDPOINTS.cancelOrder, request);
    const transaction = JupiterTriggerClient.readString(payload, 'transaction');
    const requestId = JupiterTriggerClient.readString(payload, 'requestId');

    return {
      transaction: JupiterTriggerClient.requireString(
        transaction,
        'Jupiter cancelOrder response does not contain transaction',
        requestId,
      ),
      requestId,
    };
  }

  public async cancelOrders(
    request: CancelTriggerOrdersRequest,
  ): Promise<CancelTriggerOrdersResponse> {
    JupiterTriggerClient.assertRequiredField(request.maker, 'maker');

    const normalizedRequest = {
      ...request,
      ...(request.orders && request.orders.length > 0 ? {} : { orders: undefined }),
    };

    const payload = await this.postJson(TRIGGER_ENDPOINTS.cancelOrders, normalizedRequest);
    const transactions = JupiterTriggerClient.readStringArray(payload, 'transactions');
    const requestId = JupiterTriggerClient.readString(payload, 'requestId');

    return {
      transactions: JupiterTriggerClient.requireStringArray(
        transactions,
        'Jupiter cancelOrders response does not contain transactions',
        requestId,
      ),
      requestId,
    };
  }

  public async getTriggerOrders(
    request: GetTriggerOrdersRequest,
  ): Promise<GetTriggerOrdersResponse> {
    JupiterTriggerClient.assertRequiredField(request.user, 'user');
    if (typeof request.page === 'number' && (!Number.isInteger(request.page) || request.page < 1)) {
      throw new JupiterTriggerClientError('page must be a positive integer');
    }

    const params = new URLSearchParams({
      user: request.user,
      ...(request.orderStatus ? { orderStatus: request.orderStatus } : {}),
      ...(typeof request.page === 'number' ? { page: String(request.page) } : {}),
    });

    const payload = await this.requestJson(
      `${TRIGGER_ENDPOINTS.getTriggerOrders}?${params.toString()}`,
      {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      },
    );

    const rawOrders =
      JupiterTriggerClient.readArray(payload, 'orders') ??
      JupiterTriggerClient.readArray(payload, 'data') ??
      JupiterTriggerClient.readArray(JupiterTriggerClient.readObject(payload, 'data'), 'orders') ??
      [];
    const orders = rawOrders.filter(JupiterTriggerClient.isRecord);

    return {
      orders,
      hasMoreData:
        JupiterTriggerClient.readBoolean(payload, 'hasMoreData') ??
        JupiterTriggerClient.readBoolean(JupiterTriggerClient.readObject(payload, 'data'), 'hasMoreData') ??
        false,
    };
  }

  private async postJson(path: string, body: unknown): Promise<unknown> {
    return this.requestJson(path, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  }

  private async requestJson(path: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
      });

      const payload = await JupiterTriggerClient.safeParseJson(response);
      const apiError = JupiterTriggerClient.readApiError(payload);

      if (!response.ok) {
        throw new JupiterTriggerClientError(
          apiError?.message ?? `Jupiter Trigger API HTTP ${response.status}`,
          {
            status: response.status,
            code: apiError?.code,
            requestId: apiError?.requestId,
          },
        );
      }

      if (apiError) {
        throw new JupiterTriggerClientError(
          apiError.message ?? apiError.error ?? 'Jupiter Trigger API returned an error',
          {
          code: apiError.code,
          requestId: apiError.requestId,
          },
        );
      }

      return payload;
    } catch (error) {
      if (error instanceof JupiterTriggerClientError) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new JupiterTriggerClientError('Jupiter Trigger API request timed out');
      }

      throw new JupiterTriggerClientError(
        error instanceof Error ? error.message : 'Unknown Jupiter Trigger API error',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private static async safeParseJson(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) {
      return {};
    }

    try {
      return JSON.parse(text) as unknown;
    } catch {
      return {};
    }
  }

  private static readApiError(value: unknown): JupiterApiError | null {
    if (!JupiterTriggerClient.isRecord(value)) {
      return null;
    }

    const error = JupiterTriggerClient.readString(value, 'error');
    const message = JupiterTriggerClient.readString(value, 'message');
    const code = JupiterTriggerClient.readNumber(value, 'code');
    const requestId = JupiterTriggerClient.readString(value, 'requestId');

    if (!error && !message) {
      return null;
    }

    return {
      error,
      message,
      code,
      requestId,
    };
  }

  private static readObject(
    value: unknown,
    key: string,
  ): Record<string, unknown> | undefined {
    if (!JupiterTriggerClient.isRecord(value)) {
      return undefined;
    }

    const nested = value[key];
    return JupiterTriggerClient.isRecord(nested) ? nested : undefined;
  }

  private static readString(value: unknown, key: string): string | undefined {
    if (!JupiterTriggerClient.isRecord(value)) {
      return undefined;
    }

    const candidate = value[key];
    return typeof candidate === 'string' ? candidate : undefined;
  }

  private static readNumber(value: unknown, key: string): number | undefined {
    if (!JupiterTriggerClient.isRecord(value)) {
      return undefined;
    }

    const candidate = value[key];
    if (typeof candidate === 'number') {
      return candidate;
    }

    if (typeof candidate === 'string') {
      const parsed = Number(candidate);
      return Number.isFinite(parsed) ? parsed : undefined;
    }

    return undefined;
  }

  private static readBoolean(value: unknown, key: string): boolean | undefined {
    if (!JupiterTriggerClient.isRecord(value)) {
      return undefined;
    }

    const candidate = value[key];
    if (typeof candidate === 'boolean') {
      return candidate;
    }

    if (typeof candidate === 'string') {
      if (candidate === 'true') {
        return true;
      }

      if (candidate === 'false') {
        return false;
      }
    }

    return undefined;
  }

  private static readArray(value: unknown, key: string): unknown[] | undefined {
    if (!JupiterTriggerClient.isRecord(value)) {
      return undefined;
    }

    const candidate = value[key];
    return Array.isArray(candidate) ? candidate : undefined;
  }

  private static readStringArray(value: unknown, key: string): string[] | undefined {
    const candidate = JupiterTriggerClient.readArray(value, key);
    if (!candidate) {
      return undefined;
    }

    const strings = candidate.filter((item): item is string => typeof item === 'string');
    return strings.length === candidate.length ? strings : undefined;
  }

  private static isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private static requireString(
    value: string | undefined,
    message: string,
    requestId?: string,
  ): string {
    if (value) {
      return value;
    }

    throw new JupiterTriggerClientError(message, {
      requestId,
    });
  }

  private static requireStringArray(
    value: string[] | undefined,
    message: string,
    requestId?: string,
  ): string[] {
    if (value) {
      return value;
    }

    throw new JupiterTriggerClientError(message, {
      requestId,
    });
  }

  private static assertRequiredField(value: string | undefined, fieldName: string): void {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new JupiterTriggerClientError(`Missing required field: ${fieldName}`);
    }
  }
}
