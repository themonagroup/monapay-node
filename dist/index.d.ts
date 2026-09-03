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

export interface SandboxTransactionOptions {
  amount: number;
  description?: string;
  virtual_account_number?: string;
}

export interface SandboxTransactionResult {
  transaction_code: string;
  virtual_account_number: string | null;
  account_number: string;
  amount: number;
  sandbox: true;
  is_sandbox: true;
}

export type EmailEvent = 'TRANSACTION_IN' | 'WEBHOOK_FAILED' | 'VA_CREATED';
export type EmailLogEvent = EmailEvent | 'VERIFICATION' | 'TEST' | 'RECEIPT';

export interface EmailConfigCreateOptions {
  name: string;
  recipients: string[];
  events?: EmailEvent[];
  virtual_account_id?: string;
}

export interface EmailConfigUpdateOptions {
  name?: string;
  recipients?: string[];
  events?: EmailEvent[];
  virtual_account_id?: string | null;
  is_active?: boolean;
}

export interface EmailVerificationOptions {
  email: string;
  code: string;
}

export interface EmailLogListOptions {
  configId?: string;
  status?: 'sent' | 'failed' | 'suppressed';
  eventType?: EmailLogEvent;
  fromDate?: string;
  toDate?: string;
  page?: number;
  limit?: number;
}

export interface DateRangeOptions {
  fromDate?: string;
  toDate?: string;
}

export type CheckoutStatus = 'pending' | 'paid' | 'expired' | 'cancelled';

export interface CheckoutCreateOptions {
  amount: number;
  order_code: string;
  return_url: string;
  sandbox?: boolean;
  description?: string;
  cancel_url?: string;
  payer_email?: string;
  payer_name?: string;
  expires_in?: number;
  metadata?: Record<string, unknown>;
  virtual_account_id?: string;
}

export interface CheckoutListOptions {
  status?: CheckoutStatus;
  orderCode?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  limit?: number;
}

export interface IdempotencyOptions { idempotencyKey?: string }

export interface PaymentProfileOptions {
  display_name?: string;
  logo_url?: string | null;
  hotline?: string | null;
  support_email?: string | null;
  default_bank_account_id?: string;
  default_virtual_account_id?: string | null;
  va_prefix?: string;
  owner_number?: string;
  owner_type?: 'PER' | 'ORG';
  merchant_id?: string;
  terminal_id?: string;
  beneficiary_name?: string;
  accent_color?: string | null;
  locale?: 'vi' | 'en';
  show_mona_badge?: boolean;
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
  paymentProfile: {
    get(): Promise<any>;
    set(body: PaymentProfileOptions): Promise<any>;
  };
  checkouts: {
    create(body: CheckoutCreateOptions, options?: IdempotencyOptions): Promise<any>;
    get(id: string): Promise<any>;
    list(options?: CheckoutListOptions): Promise<any>;
    cancel(id: string, options?: IdempotencyOptions): Promise<any>;
  };
  qr: {
    generate(body: Record<string, unknown>): Promise<any>;
    cancel(id: string, body?: Record<string, unknown>): Promise<any>;
  };
  transactions: {
    list(options: TransactionListOptions): Promise<any>;
    iterate(options: TransactionListOptions): AsyncGenerator<any, void, unknown>;
    retry(id: string, options: RetryOptions): Promise<any>;
  };
  sandbox: {
    transaction(options: SandboxTransactionOptions): Promise<SandboxTransactionResult>;
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
  emailConfigs: {
    list(): Promise<any>;
    get(id: string): Promise<any>;
    create(body: EmailConfigCreateOptions): Promise<any>;
    update(id: string, body: EmailConfigUpdateOptions): Promise<any>;
    remove(id: string): Promise<any>;
    verify(id: string, body: EmailVerificationOptions): Promise<any>;
    resendVerification(id: string, body: Pick<EmailVerificationOptions, 'email'>): Promise<any>;
    test(id: string): Promise<any>;
  };
  emailLogs: {
    list(options?: EmailLogListOptions): Promise<any>;
    stats(options?: DateRangeOptions): Promise<any>;
  };
  emailSuppressions: {
    list(): Promise<any>;
    remove(email: string): Promise<any>;
  };
}

export function verifyWebhook<T = Record<string, unknown>>(options: WebhookVerifyOptions): WebhookResult<T>;
export function expressWebhook(
  secret: string,
  handler: (payload: any, request: any, response: any) => unknown | Promise<unknown>,
  options?: { toleranceSec?: number },
): (request: any, response: any, next?: (error?: unknown) => void) => Promise<void>;

export default MonaPay;
