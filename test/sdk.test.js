import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import { MonaPay, verifyWebhook } from '../dist/index.js';

function response(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function signed(rawBody, secret, timestamp) {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
}

test('verifyWebhook chấp nhận chữ ký đúng và header không phân biệt hoa thường', () => {
  const timestamp = Math.floor(Date.now() / 1000);
  const rawBody = JSON.stringify({ amount: 2500000, transaction_code: 'FT1' });
  const result = verifyWebhook({
    rawBody,
    secret: 'test-secret',
    headers: {
      'X-Mona-Timestamp': String(timestamp),
      'x-mona-signature': signed(rawBody, 'test-secret', timestamp),
    },
  });
  assert.deepEqual(result, { ok: true, payload: { amount: 2500000, transaction_code: 'FT1' } });
});

test('verifyWebhook từ chối chữ ký sai', () => {
  const timestamp = Math.floor(Date.now() / 1000);
  const result = verifyWebhook({
    rawBody: '{}',
    secret: 'test-secret',
    headers: { 'x-mona-timestamp': String(timestamp), 'x-mona-signature': `sha256=${'0'.repeat(64)}` },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid_signature');
});

test('verifyWebhook từ chối timestamp ngoài cửa sổ', () => {
  const timestamp = Math.floor(Date.now() / 1000) - 301;
  const result = verifyWebhook({
    rawBody: '{}',
    secret: 'test-secret',
    toleranceSec: 300,
    headers: { 'x-mona-timestamp': String(timestamp), 'x-mona-signature': signed('{}', 'test-secret', timestamp) },
  });
  assert.deepEqual(result, { ok: false, reason: 'timestamp_out_of_tolerance' });
});

test('client dựng URL và header đúng, tự cache token', async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/api/v1/client/login')) {
      return response({ success: true, message: 'ok', data: { access_token: 'token-1', expires_in: 86400 } });
    }
    return response({ success: true, message: 'ok', data: { id: 'hook-1' } });
  };
  const client = new MonaPay({
    baseUrl: 'https://example.test/', username: 'user', password: 'pass', clientSecret: 'client-secret', fetch,
  });
  await client.webhooks.create({ name: 'Shop', webhook_url: 'https://shop.test/hook' });
  await client.me();

  assert.equal(calls.length, 3);
  assert.equal(calls[1].url, 'https://example.test/api/v1/client-webhooks');
  assert.equal(calls[1].init.headers.Authorization, 'Bearer token-1');
  assert.equal(calls[1].init.headers['X-Client-Secret'], 'client-secret');
  assert.equal(calls[1].init.headers['Content-Type'], 'application/json');
  assert.equal(calls[2].init.headers['X-Client-Secret'], undefined);
});

test('client login lại một lần khi API trả 401', async () => {
  let loginCount = 0;
  let meCount = 0;
  const fetch = async (url, init) => {
    if (url.endsWith('/api/v1/client/login')) {
      loginCount += 1;
      return response({ success: true, data: { access_token: `token-${loginCount}` } });
    }
    meCount += 1;
    if (meCount === 1) return response({ detail: 'expired' }, 401);
    assert.equal(init.headers.Authorization, 'Bearer token-2');
    return response({ success: true, data: { username: 'user' } });
  };
  const client = new MonaPay({ username: 'user', password: 'pass', fetch });
  assert.deepEqual(await client.me(), { username: 'user' });
  assert.equal(loginCount, 2);
});

test('transactions.iterate đọc hết các trang', async () => {
  const pages = [];
  const fetch = async (url) => {
    if (url.endsWith('/api/v1/client/login')) {
      return response({ success: true, data: { access_token: 'token' } });
    }
    const parsed = new URL(url);
    const page = Number(parsed.searchParams.get('page'));
    pages.push(page);
    assert.equal(parsed.searchParams.get('virtual_account_number'), 'MONA 01');
    return response({
      success: true,
      data: page === 1
        ? { data: [{ id: 'tx-1' }, { id: 'tx-2' }], current_page: 1, last_page: 2, has_next: true }
        : { data: [{ id: 'tx-3' }], current_page: 2, last_page: 2, has_next: false },
    });
  };
  const client = new MonaPay({ username: 'user', password: 'pass', fetch });
  const items = [];
  for await (const item of client.transactions.iterate({ virtualAccountNumber: 'MONA 01', limit: 2 })) items.push(item);
  assert.deepEqual(items.map((item) => item.id), ['tx-1', 'tx-2', 'tx-3']);
  assert.deepEqual(pages, [1, 2]);
});
