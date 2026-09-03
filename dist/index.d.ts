export interface MonaPayOptions {
  baseUrl?: string;
  clientId?: string;
  clientSecret?: string;
  username?: string;
  password?: string;
  fetch?: typeof globalThis.fetch;
}

export interface TransactionListOptions {
  virtualAccountNumber: string;
  page?: number;
  limit?: number;
}

export interface RetryOptions {
  targetType: 'WEBHOOK' | 'TELEGRAM';
  targetId?: string;
}

export interface WebhookVerifyOptions {
  rawBody: string | Uint8Array;
  headers: Headers | Record<string, string | string[] | undefined>;
  secret: string;
  toleranceSec?: number;
}

export type WebhookResult<T = Record<string, unknown>> =
  | { ok: true; payload: T }
  | { ok: false; reason: 'missing_timestamp' | 'invalid_timestamp' | 'timestamp_out_of_tolerance' | 'missing_signature' | 'invalid_signature' | 'invalid_json'; payload?: never };

export class MonaPayError extends Error {
  status?: number;
  body?: unknown;
}

export class MonaPay {
  constructor(options: MonaPayOptions);
  static fromEnv(env?: Record<string, string | undefined>): MonaPay;
  baseUrl: string;
  clientId?: string;
  clientSecret?: string;
  me(): Promise<any>;
  registerVirtualAccount(body: Record<string, unknown>): Promise<any>;
  verifyVirtualAccount(requestId: string, code: string): Promise<any>;
  registerNotification(vaId: string, body?: { receive_noti_realtime: boolean; username?: string }): Promise<any>;
  verifyNotification(requestId: string, code: string): Promise<any>;
  notificationDetail(vaId: string): Promise<any>;
  keys: {
    generate(name?: string): Promise<any>;
    list(): Promise<any>;
    destroy(id: string): Promise<any>;
  };
  va: {
    register(body: Record<string, unknown>): Promise<any>;
    verify(requestId: string, code: string): Promise<any>;
    registerNotification(vaId: string, body?: { receive_noti_realtime: boolean; username?: string }): Promise<any>;
    verifyNotification(requestId: string, code: string): Promise<any>;
    notificationDetail(vaId: string): Promise<any>;
    list(bankAccountId: string): Promise<any>;
  };
  bankAccounts: { list(): Promise<any> };
  qr: {
    generate(body: Record<string, unknown>): Promise<any>;
    cancel(id: string, body?: Record<string, unknown>): Promise<any>;
  };
  transactions: {
    list(options: TransactionListOptions): Promise<any>;
    iterate(options: TransactionListOptions): AsyncGenerator<any, void, unknown>;
    retry(id: string, options: RetryOptions): Promise<any>;
  };
  webhooks: {
    list(): Promise<any>;
    create(body: Record<string, unknown>): Promise<any>;
    update(id: string, body: Record<string, unknown>): Promise<any>;
    remove(id: string): Promise<any>;
    test(body: Record<string, unknown>): Promise<any>;
  };
  webhookLogs: {
    list(options?: { status?: 'success' | 'failed'; fromDate?: string; toDate?: string; page?: number; limit?: number }): Promise<any>;
    stats(options?: { status?: 'success' | 'failed'; fromDate?: string; toDate?: string; page?: number; limit?: number }): Promise<any>;
  };
}

export function verifyWebhook<T = Record<string, unknown>>(options: WebhookVerifyOptions): WebhookResult<T>;
export function expressWebhook(
  secret: string,
  handler: (payload: any, request: any, response: any) => unknown | Promise<unknown>,
  options?: { toleranceSec?: number },
): (request: any, response: any, next?: (error?: unknown) => void) => Promise<void>;

export default MonaPay;
