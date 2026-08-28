'use strict';

const { createHmac, timingSafeEqual } = require('node:crypto');

const DEFAULT_BASE_URL = 'https://api.monapay.vn';

class MonaPayError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'MonaPayError';
    this.status = options.status;
    this.body = options.body;
  }
}

function trimBaseUrl(value) {
  return String(value || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function segment(value) {
  return encodeURIComponent(String(value));
}

function getHeader(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === 'function') return headers.get(name) ?? undefined;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) {
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return undefined;
}

function rawBytes(rawBody) {
  if (typeof rawBody === 'string') return Buffer.from(rawBody, 'utf8');
  if (rawBody instanceof Uint8Array) {
    return Buffer.from(rawBody.buffer, rawBody.byteOffset, rawBody.byteLength);
  }
  throw new TypeError('rawBody phải là string, Buffer hoặc Uint8Array');
}

function verifyWebhook({ rawBody, headers, secret, toleranceSec = 300 }) {
  const bytes = rawBytes(rawBody);
  const timestampHeader = getHeader(headers, 'x-mona-timestamp');
  const signatureHeader = getHeader(headers, 'x-mona-signature');

  if (timestampHeader == null || timestampHeader === '') {
    return { ok: false, reason: 'missing_timestamp' };
  }
  const timestampText = String(timestampHeader);
  if (!/^\d+$/.test(timestampText)) {
    return { ok: false, reason: 'invalid_timestamp' };
  }
  const timestamp = Number(timestampText);
  if (!Number.isSafeInteger(timestamp)) {
    return { ok: false, reason: 'invalid_timestamp' };
  }
  if (!Number.isFinite(toleranceSec) || toleranceSec < 0) {
    throw new RangeError('toleranceSec phải là số không âm');
  }
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > toleranceSec) {
    return { ok: false, reason: 'timestamp_out_of_tolerance' };
  }
  if (signatureHeader == null || signatureHeader === '') {
    return { ok: false, reason: 'missing_signature' };
  }

  const expected = createHmac('sha256', String(secret))
    .update(Buffer.from(`${timestampText}.`, 'utf8'))
    .update(bytes)
    .digest();
  const match = /^sha256=([0-9a-fA-F]{64})$/.exec(String(signatureHeader));
  const supplied = match ? Buffer.from(match[1], 'hex') : Buffer.alloc(expected.length);
  const signatureOk = timingSafeEqual(expected, supplied) && Boolean(match);
  if (!signatureOk) return { ok: false, reason: 'invalid_signature' };

  try {
    return { ok: true, payload: JSON.parse(bytes.toString('utf8')) };
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
}

function expressWebhook(secret, handler, options = {}) {
  if (typeof handler !== 'function') throw new TypeError('handler phải là một hàm');
  return async function monaPayWebhookMiddleware(req, res, next) {
    try {
      const body = req.rawBody ?? req.body;
      if (!(typeof body === 'string' || body instanceof Uint8Array)) {
        res.status(400).json({ ok: false, reason: 'raw_body_required' });
        return;
      }
      const result = verifyWebhook({
        rawBody: body,
        headers: req.headers,
        secret,
        toleranceSec: options.toleranceSec ?? 300,
      });
      if (!result.ok) {
        res.status(401).json({ ok: false, reason: result.reason });
        return;
      }
      await handler(result.payload, req, res);
    } catch (error) {
      if (typeof next === 'function') next(error);
      else throw error;
    }
  };
}

class MonaPay {
  constructor({ baseUrl = DEFAULT_BASE_URL, username, password, clientSecret, fetch: fetchImpl } = {}) {
    if (!username || !password) throw new TypeError('username và password là bắt buộc');
    this.baseUrl = trimBaseUrl(baseUrl);
    this.username = username;
    this.password = password;
    this.clientSecret = clientSecret;
    this._fetch = fetchImpl || globalThis.fetch;
    if (typeof this._fetch !== 'function') {
      throw new TypeError('Môi trường cần fetch built-in (Node.js >=18)');
    }
    this._token = undefined;
    this._loginPromise = undefined;

    this.keys = Object.freeze({
      generate: async (name = 'Default Key') => {
        const data = await this._request('POST', '/api/v1/client-keys/generate', { body: { name } });
        if (!this.clientSecret && data?.client_secret) this.clientSecret = data.client_secret;
        return data;
      },
      list: () => this._request('GET', '/api/v1/client-keys/list'),
      destroy: (id) => this._request('DELETE', `/api/v1/client-keys/destroy/${segment(id)}`),
    });
    this.va = Object.freeze({
      register: (body) => this._request('POST', '/api/v1/acb/virtual-account/registration', { body }),
      verify: (requestId, code) => this._request('POST', `/api/v1/acb/${segment(requestId)}/virtual-account/verification`, { body: { code } }),
      registerNotification: (vaId, body) => this._request('POST', `/api/v1/acb/${segment(vaId)}/notification/registration`, { body }),
      verifyNotification: (requestId, code) => this._request('POST', `/api/v1/acb/${segment(requestId)}/notification/verification`, { body: { code } }),
      list: (bankAccountId) => this._request('GET', `/api/v1/acb/${segment(bankAccountId)}/virtual-account/retrieve`),
    });
    this.bankAccounts = Object.freeze({
      list: () => this._request('GET', '/api/v1/client/bank-accounts'),
    });
    this.qr = Object.freeze({
      generate: (body) => this._request('POST', '/api/v1/acb/qr-payment/generate', { body }),
      cancel: (id, body) => this._request('DELETE', `/api/v1/acb/qr-payment/${segment(id)}/cancellation`, { body }),
    });
    this.transactions = Object.freeze({
      list: (options) => this._listTransactions(options),
      iterate: (options) => this._iterateTransactions(options),
      retry: (id, options) => this._request('POST', `/api/v1/acb/virtual-account/transactions/${segment(id)}/retry`, {
        body: {
          target_type: options?.targetType,
          ...(options?.targetId == null ? {} : { target_id: options.targetId }),
        },
      }),
    });
    this.webhooks = Object.freeze({
      list: () => this._request('GET', '/api/v1/client-webhooks'),
      create: (body) => this._request('POST', '/api/v1/client-webhooks', { body }),
      update: (id, body) => this._request('PUT', `/api/v1/client-webhooks/${segment(id)}`, { body }),
      remove: (id) => this._request('DELETE', `/api/v1/client-webhooks/${segment(id)}`),
      test: (body) => this._request('POST', '/api/v1/client-webhooks/test', { body }),
    });
    this.webhookLogs = Object.freeze({
      list: (options = {}) => this._request('GET', '/api/v1/webhook-logs', { query: logQuery(options) }),
      stats: (options = {}) => this._request('GET', '/api/v1/webhook-logs/stats', { query: logQuery(options) }),
    });
  }

  me() {
    return this._request('GET', '/api/v1/client/me');
  }

  async _login() {
    if (this._loginPromise) return this._loginPromise;
    this._loginPromise = (async () => {
      const data = await this._send('POST', '/api/v1/client/login', {
        body: { username: this.username, password: this.password },
        authenticated: false,
      });
      if (!data?.access_token) throw new MonaPayError('Response đăng nhập không có access_token');
      this._token = data.access_token;
      return this._token;
    })();
    try {
      return await this._loginPromise;
    } finally {
      this._loginPromise = undefined;
    }
  }

  async _request(method, path, options = {}) {
    if (!this._token) await this._login();
    try {
      return await this._send(method, path, { ...options, authenticated: true });
    } catch (error) {
      if (error instanceof MonaPayError && error.status === 401 && options.retry !== false) {
        this._token = undefined;
        await this._login();
        return this._send(method, path, { ...options, authenticated: true, retry: false });
      }
      throw error;
    }
  }

  async _send(method, path, options = {}) {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(options.query || {})) {
      if (value != null) url.searchParams.set(key, String(value));
    }
    const headers = { Accept: 'application/json' };
    if (options.authenticated) headers.Authorization = `Bearer ${this._token}`;
    if (method !== 'GET' && options.authenticated && this.clientSecret) {
      headers['X-Client-Secret'] = this.clientSecret;
    }
    let body;
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
    const response = await this._fetch(url.toString(), { method, headers, ...(body === undefined ? {} : { body }) });
    const text = await response.text();
    let json = {};
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        throw new MonaPayError(`MONA Pay trả response không phải JSON (HTTP ${response.status})`, {
          status: response.status,
          body: text,
        });
      }
    }
    if (!response.ok || json.success === false) {
      const detail = typeof json.detail === 'string' ? json.detail : undefined;
      throw new MonaPayError(json.message || detail || `MONA Pay API lỗi HTTP ${response.status}`, {
        status: response.status,
        body: json,
      });
    }
    return json.data;
  }

  _listTransactions({ virtualAccountNumber, page = 1, limit = 100 } = {}) {
    if (!virtualAccountNumber) throw new TypeError('virtualAccountNumber là bắt buộc');
    return this._request('GET', '/api/v1/acb/virtual-account/transactions', {
      query: { virtual_account_number: virtualAccountNumber, page, limit },
    });
  }

  async *_iterateTransactions({ virtualAccountNumber, page = 1, limit = 100 } = {}) {
    let currentPage = page;
    for (;;) {
      const result = await this._listTransactions({ virtualAccountNumber, page: currentPage, limit });
      for (const transaction of result?.data || []) yield transaction;
      const hasNext = typeof result?.has_next === 'boolean'
        ? result.has_next
        : currentPage < Number(result?.last_page || currentPage);
      if (!hasNext) return;
      currentPage += 1;
    }
  }
}

function logQuery(options) {
  return {
    status: options.status,
    from_date: options.fromDate,
    to_date: options.toDate,
    page: options.page,
    limit: options.limit,
  };
}

module.exports = { MonaPay, MonaPayError, verifyWebhook, expressWebhook };
