# @monapay/node

MONA Pay là cổng thanh toán và API ngân hàng của The MONA Group, giúp doanh nghiệp Việt Nam nhận và xác nhận tiền chuyển khoản theo thời gian thực qua tài khoản ảo (VA), VietQR, webhook và Telegram — thiết kế để cả lập trình viên lẫn AI agent tích hợp trong vài phút.

SDK Node.js/TypeScript zero-dependency, dùng `fetch` built-in của Node.js 18 trở lên. MONA Pay miễn phí hoàn toàn.

## Cài đặt

```bash
npm install @monapay/node
```

## Tích hợp trong 5 phút

```js
import { MonaPay, verifyWebhook } from '@monapay/node';

const mona = new MonaPay({
  username: process.env.MONA_USERNAME,
  password: process.env.MONA_PASSWORD,
  clientSecret: process.env.MONA_CLIENT_SECRET, // có thể bỏ ở lần chạy đầu
});

// 1. Lệnh đầu tiên tự login; các lệnh sau dùng lại token.
console.log(await mona.me());

// 2. Tạo key ở lần chạy đầu. Secret chỉ được API trả về một lần và SDK
// tự giữ secret này cho các lệnh ghi tiếp theo trong cùng instance.
const key = await mona.keys.generate('Web ban hang');
console.log('Lưu MONA_CLIENT_SECRET an toàn:', key.client_secret);

// 3. Đăng ký webhook HMAC.
await mona.webhooks.create({
  name: 'Web ban hang',
  webhook_url: 'https://shop.vn/webhooks/monapay',
  auth_type: 'HMAC_SHA256',
  secret_key: process.env.MONA_WEBHOOK_SECRET,
  payload_format: 'application/json',
});

// 4. Trong route nhận webhook, xác thực đúng raw body trước khi xử lý.
const verified = verifyWebhook({
  rawBody, headers,
  secret: process.env.MONA_WEBHOOK_SECRET,
});
if (!verified.ok) throw new Error(verified.reason);

// 5. Tạo VietQR động.
const qr = await mona.qr.generate({
  ownerNumber: '123456789', ownerType: 'ORG',
  merchantId: 'MC00012345', terminalId: 'TM0001', orderId: 'DH10234',
  virtualAccountPrefix: 'MONA', beneficiaryName: 'CONG TY ABC',
  amount: 2500000, description: 'Thanh toan DH10234',
});
console.log(qr.qr_data_url);
```

`MonaPay` tự đăng nhập lại và thử lại request đúng một lần nếu token hết hạn (HTTP 401). Các method trả trực tiếp trường `data` của response. Lỗi ném `MonaPayError`, có `status` và `body` để log.

## Xác thực webhook từ raw body

Không stringify lại object đã parse: chữ ký được tính trên đúng byte của request body.

```js
const rawBody = new Uint8Array(await request.arrayBuffer());
const result = verifyWebhook({
  rawBody,
  headers: request.headers,
  secret: process.env.MONA_WEBHOOK_SECRET,
});
if (!result.ok) return new Response(result.reason, { status: 401 });
console.log(result.payload.transaction_code);
```

Với Express, đặt raw-body parser trên route trước middleware SDK:

```js
import express from 'express';
import { expressWebhook } from '@monapay/node';

const app = express();
app.post('/webhooks/monapay', express.raw({ type: 'application/json' }),
  expressWebhook(process.env.MONA_WEBHOOK_SECRET, async (payload, req, res) => {
    await saveOnce(payload.transaction_code, payload);
    res.status(200).json({ ok: true });
  }));
```

Ví dụ Next.js App Router đầy đủ ở `examples/nextjs-route.js`. Nên lưu `transaction_code` bằng unique constraint để chống xử lý trùng khi gửi lại.

## Các nhóm method

- `me()`; `keys.generate/list/destroy`; `bankAccounts.list`.
- `va.register/verify/registerNotification/verifyNotification/list`.
- `qr.generate/cancel`.
- `transactions.list`, async generator `transactions.iterate`, `transactions.retry`.
- `webhooks.list/create/update/remove/test`; `webhookLogs.list/stats`.

```js
for await (const tx of mona.transactions.iterate({
  virtualAccountNumber: 'MONA0000010234', limit: 100,
})) {
  console.log(tx.transaction_code, tx.amount);
}

await mona.transactions.retry('transaction-id', {
  targetType: 'WEBHOOK', targetId: 'webhook-config-id',
});
```

QR cancellation nhận `id` và có thể nhận body thứ hai nếu cấu hình ACB của tài khoản yêu cầu gửi lại `ownerNumber`, `ownerType`, `orderId`, `amount`.

Tài liệu: https://monapay.vn/docs · AI/LLM: https://monapay.vn/llms.txt · Hotline 1900 636 648 · info@themona.global

## Phát triển

```bash
node --test
```

License MIT.
