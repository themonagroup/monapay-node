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

test('client credentials dùng OAuth, cache token và gửi secret cho lệnh ghi', async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/api/v1/oauth/token')) {
      return response({ success: true, data: { access_token: 'oauth-token', expires_in: 3600 } });
    }
    return response({ success: true, data: { username: 'shop' } });
  };
  const client = new MonaPay({
    baseUrl: 'https://example.test', clientId: 'client-id', clientSecret: 'client-secret', fetch,
  });
  await client.webhooks.create({ name: 'Shop', webhook_url: 'https://shop.test/hook' });
  await client.me();
  assert.equal(calls.filter((call) => call.url.endsWith('/api/v1/oauth/token')).length, 1);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    grant_type: 'client_credentials', client_id: 'client-id', client_secret: 'client-secret',
  });
  assert.equal(calls[1].init.headers['X-Client-Secret'], 'client-secret');
});

test('fromEnv ưu tiên client credentials', () => {
  const client = MonaPay.fromEnv({
    MONAPAY_CLIENT_ID: 'client-id', MONAPAY_CLIENT_SECRET: 'client-secret',
    MONAPAY_USERNAME: 'legacy-user', MONAPAY_PASSWORD: 'legacy-pass',
  });
  assert.equal(client.clientId, 'client-id');
  assert.equal(client.username, undefined);
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

test('va hỗ trợ đủ 5 method cho luồng nối ngân hàng bằng OTP', async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/api/v1/oauth/token')) {
      return response({ success: true, data: { access_token: 'token', expires_in: 3600 } });
    }
    return response({ success: true, data: { ok: true } });
  };
  const client = new MonaPay({
    baseUrl: 'https://example.test', clientId: 'client-id', clientSecret: 'client-secret', fetch,
  });
  await client.registerVirtualAccount({ account_number: 123456789, virtual_account_info: { virtual_account_prefix_code: 'LOC' } });
  await client.verifyVirtualAccount('request/id', '123456');
  await client.registerNotification('va/id');
  await client.verifyNotification('notification/id', '654321');
  await client.notificationDetail('va/id');

  const apiCalls = calls.slice(1);
  assert.equal(apiCalls[0].url, 'https://example.test/api/v1/acb/virtual-account/registration');
  assert.equal(apiCalls[1].url, 'https://example.test/api/v1/acb/request%2Fid/virtual-account/verification');
  assert.deepEqual(JSON.parse(apiCalls[1].init.body), { code: '123456' });
  assert.equal(apiCalls[2].url, 'https://example.test/api/v1/acb/va%2Fid/notification/registration');
  assert.deepEqual(JSON.parse(apiCalls[2].init.body), { receive_noti_realtime: true });
  assert.equal(apiCalls[3].url, 'https://example.test/api/v1/acb/notification%2Fid/notification/verification');
  assert.equal(apiCalls[4].url, 'https://example.test/api/v1/acb/va%2Fid/notification/details');
  assert.equal(apiCalls[4].init.method, 'GET');
});

test('email resources ánh xạ đủ config, log, stats và suppression', async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/api/v1/oauth/token')) {
      return response({ success: true, data: { access_token: 'token', expires_in: 3600 } });
    }
    return response({ success: true, data: { ok: true } });
  };
  const client = new MonaPay({
    baseUrl: 'https://example.test', clientId: 'client-id', clientSecret: 'client-secret', fetch,
  });
  await client.emailConfigs.list();
  await client.emailConfigs.get('config/id');
  await client.emailConfigs.create({ name: 'Kế toán', recipients: ['kt@example.com'], events: ['TRANSACTION_IN'] });
  await client.emailConfigs.update('config/id', { is_active: true, virtual_account_id: null });
  await client.emailConfigs.remove('config/id');
  await client.emailConfigs.verify('config/id', { email: 'kt@example.com', code: '123456' });
  await client.emailConfigs.resendVerification('config/id', { email: 'kt@example.com' });
  await client.emailConfigs.test('config/id');
  await client.emailLogs.list({ configId: 'config/id', status: 'sent', eventType: 'TEST', fromDate: '2026-09-01', page: 2, limit: 100 });
  await client.emailLogs.stats({ fromDate: '2026-09-01', toDate: '2026-09-03' });
  await client.emailSuppressions.list();
  await client.emailSuppressions.remove('bounce+tag@example.com');

  const apiCalls = calls.slice(1);
  assert.equal(apiCalls.length, 12);
  assert.equal(apiCalls[0].url, 'https://example.test/api/v1/email-configs');
  assert.equal(apiCalls[1].url, 'https://example.test/api/v1/email-configs/config%2Fid');
  assert.deepEqual(JSON.parse(apiCalls[2].init.body), { name: 'Kế toán', recipients: ['kt@example.com'], events: ['TRANSACTION_IN'] });
  assert.deepEqual(JSON.parse(apiCalls[3].init.body), { is_active: true, virtual_account_id: null });
  assert.equal(apiCalls[4].init.method, 'DELETE');
  assert.deepEqual(JSON.parse(apiCalls[5].init.body), { email: 'kt@example.com', code: '123456' });
  assert.ok(apiCalls[6].url.endsWith('/config%2Fid/resend-verification'));
  assert.deepEqual(JSON.parse(apiCalls[7].init.body), {});
  assert.match(apiCalls[8].url, /config_id=config%2Fid/);
  assert.match(apiCalls[8].url, /event_type=TEST/);
  assert.match(apiCalls[9].url, /to_date=2026-09-03/);
  assert.equal(apiCalls[10].url, 'https://example.test/api/v1/email-suppressions');
  assert.equal(apiCalls[11].url, 'https://example.test/api/v1/email-suppressions/bounce%2Btag%40example.com');
  for (const call of apiCalls.filter(({ init }) => init.method !== 'GET')) {
    assert.equal(call.init.headers['X-Client-Secret'], 'client-secret');
  }
});

test('checkouts và paymentProfile ánh xạ đủ 6 method, query và idempotency', async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/api/v1/oauth/token')) {
      return response({ success: true, data: { access_token: 'token', expires_in: 3600 } });
    }
    return response({ success: true, data: { ok: true } });
  };
  const client = new MonaPay({
    baseUrl: 'https://example.test', clientId: 'client-id', clientSecret: 'client-secret', fetch,
  });
  await client.paymentProfile.get();
  await client.paymentProfile.set({ display_name: 'Shop MONA', locale: 'vi' });
  await client.checkouts.create(
    { amount: 250000, order_code: 'DH_10234', return_url: 'https://shop.test/return', sandbox: true },
    { idempotencyKey: 'create-key' },
  );
  await client.checkouts.get('checkout/id');
  await client.checkouts.list({ status: 'pending', orderCode: 'DH_10234', fromDate: '2026-09-01', page: 2, limit: 50 });
  await client.checkouts.cancel('checkout/id', { idempotencyKey: 'cancel-key' });

  const apiCalls = calls.slice(1);
  assert.equal(apiCalls.length, 6);
  assert.equal(apiCalls[0].url, 'https://example.test/api/v1/payment-profile');
  assert.equal(apiCalls[0].init.method, 'GET');
  assert.equal(apiCalls[1].init.method, 'PUT');
  assert.deepEqual(JSON.parse(apiCalls[1].init.body), { display_name: 'Shop MONA', locale: 'vi' });
  assert.equal(apiCalls[2].url, 'https://example.test/api/v1/checkouts');
  assert.equal(apiCalls[2].init.headers['Idempotency-Key'], 'create-key');
  assert.deepEqual(JSON.parse(apiCalls[2].init.body), {
    amount: 250000,
    order_code: 'DH_10234',
    return_url: 'https://shop.test/return',
    sandbox: true,
  });
  assert.equal(apiCalls[3].url, 'https://example.test/api/v1/checkouts/checkout%2Fid');
  assert.match(apiCalls[4].url, /status=pending/);
  assert.match(apiCalls[4].url, /order_code=DH_10234/);
  assert.match(apiCalls[4].url, /limit=50/);
  assert.equal(apiCalls[5].url, 'https://example.test/api/v1/checkouts/checkout%2Fid/cancel');
  assert.equal(apiCalls[5].init.headers['Idempotency-Key'], 'cancel-key');
  assert.deepEqual(JSON.parse(apiCalls[5].init.body), {});
  for (const call of apiCalls.filter(({ init }) => init.method !== 'GET')) {
    assert.equal(call.init.headers['X-Client-Secret'], 'client-secret');
  }
});

test('sandbox.transaction gửi đúng endpoint và giữ nguyên payload', async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/api/v1/oauth/token')) {
      return response({ success: true, data: { access_token: 'token', expires_in: 3600 } });
    }
    return response({
      success: true,
      data: {
        transaction_code: 'SANDBOX-1',
        virtual_account_number: 'SBX0001',
        account_number: '0000000001',
        amount: 10000,
        sandbox: true,
        is_sandbox: true,
      },
    });
  };
  const client = new MonaPay({
    baseUrl: 'https://example.test', clientId: 'client-id', clientSecret: 'client-secret', fetch,
  });
  const body = { amount: 10000, description: 'DH10234', virtual_account_number: 'SBX0001' };
  const result = await client.sandbox.transaction(body);

  assert.equal(calls[1].url, 'https://example.test/api/v1/sandbox/transactions');
  assert.equal(calls[1].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[1].init.body), body);
  assert.equal(calls[1].init.headers['X-Client-Secret'], 'client-secret');
  assert.equal(result.transaction_code, 'SANDBOX-1');
});
