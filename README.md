# @monapay/node

MONA Pay là cổng thanh toán và API ngân hàng của The MONA Group, giúp doanh nghiệp Việt Nam nhận và xác nhận tiền chuyển khoản theo thời gian thực qua tài khoản ảo (VA), VietQR, webhook, Telegram và email, thiết kế để cả lập trình viên lẫn AI agent tích hợp trong vài phút.

SDK Node.js/TypeScript zero-dependency, dùng `fetch` built-in của Node.js 18 trở lên. MONA Pay miễn phí hoàn toàn.

## Tạo link thu tiền

```js
import { MonaPay } from '@monapay/node';
const mona = MonaPay.fromEnv();
const checkout = await mona.checkouts.create({
  amount: 250000, order_code: 'DH10234', return_url: 'https://shop.vn/payment/return',
});
console.log(checkout.checkout_url);
```

## Cài đặt

```bash
npm install @monapay/node
```

## Sử dụng

Các sub-client dùng trực tiếp: `me`, `keys`, `bankAccounts`, `virtualAccounts`, `qr`, `transactions`, `webhooks`, `webhookLogs`, `emailConfigs`, `emailLogs`, `checkouts`, `paymentProfile`, `sandbox`.

Khởi tạo từ biến môi trường bằng `MonaPay.fromEnv()` hoặc truyền credentials tường minh:

```js
import { MonaPay, verifyWebhook } from '@monapay/node';

const mona = MonaPay.fromEnv();

const monaExplicit = new MonaPay({
  clientId: process.env.MONAPAY_CLIENT_ID,
  clientSecret: process.env.MONAPAY_CLIENT_SECRET,
});

// 1. Lệnh đầu tiên tự lấy OAuth token; các lệnh sau dùng lại token tới gần hạn.
console.log(await mona.me());

// 2. Đăng ký webhook HMAC.
await mona.webhooks.create({
  name: 'Web ban hang',
  webhook_url: 'https://shop.vn/webhooks/monapay',
  auth_type: 'HMAC_SHA256',
  secret_key: process.env.MONA_WEBHOOK_SECRET,
  payload_format: 'application/json',
});

// 3. Trong route nhận webhook, xác thực đúng raw body trước khi xử lý.
const verified = verifyWebhook({
  rawBody, headers,
  secret: process.env.MONA_WEBHOOK_SECRET,
});
if (!verified.ok) throw new Error(verified.reason);

// 4. Tạo VietQR động.
const qr = await mona.qr.generate({
  ownerNumber: '123456789', ownerType: 'ORG',
  merchantId: 'MC00012345', terminalId: 'TM0001', orderId: 'DH10234',
  virtualAccountPrefix: 'MONA', beneficiaryName: 'CONG TY ABC',
  amount: 2500000, description: 'Thanh toan DH10234',
});
console.log(qr.qr_data_url);
```

`MonaPay.fromEnv()` ưu tiên `MONAPAY_CLIENT_ID` + `MONAPAY_CLIENT_SECRET`. Cách cũ `MONAPAY_USERNAME` + `MONAPAY_PASSWORD` vẫn được hỗ trợ, nhưng tài khoản bật 2FA không login bằng mật khẩu được. SDK cache token theo `expires_in` (làm mới sớm 60 giây) và thử lại request đúng một lần nếu gặp HTTP 401. Các method trả trực tiếp trường `data` của response. Lỗi ném `MonaPayError`, có `status` và `body` để log.

## Thử bằng sandbox (không cần nối ngân hàng)

```js
const checkout = await mona.checkouts.create({
  amount: 10000, order_code: 'DH10234',
  return_url: 'https://shop.vn/payment/return', sandbox: true,
});
await mona.sandbox.transaction({
  virtual_account_number: checkout.bank.account_number,
  amount: checkout.amount, description: checkout.order_code,
});
const paid = await mona.checkouts.get(checkout.id);
console.log(paid.status); // "paid"
```

Webhook `CHECKOUT_PAID` có trường `checkout_id`, không phải `id`; ví dụ: `await fulfill(event.checkout_id)`.

## Nối ngân hàng bằng OTP (4 bước)

OTP do ACB gửi về số điện thoại đăng ký của chủ tài khoản. Ứng dụng phải hỏi người dùng ở bước 2 và 4, không tự tạo hoặc lưu OTP.

```js
const registration = await mona.registerVirtualAccount({
  customer_type: 'PERS',
  account_number: 123456789,
  phone_number: '0901234567',
  virtual_account_info: {
    virtual_account_prefix_code: 'LOC',
    virtual_account_content: 'DH10234',
    virtual_account_explain: 'Don hang 10234',
  },
  user_agreement: true,
});

const va = await mona.verifyVirtualAccount(registration.acb_request.id, otpNguoiDungNhap);
const notification = await mona.registerNotification(va.id);
await mona.verifyNotification(notification.acb_request.id, otpLanHaiNguoiDungNhap);

console.log(await mona.notificationDetail(va.id));
```

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

## Thông báo qua email

MONA Pay gửi mã 6 số tới từng địa chỉ mới. Ứng dụng phải hỏi người dùng mã trong hộp thư rồi xác minh, không tự đoán mã.

```js
const config = await mona.emailConfigs.create({ name: 'Kế toán', recipients: ['kt@shop.vn'] });
const email = config.pending_verification[0];
const code = await askUserForCode(email);
await mona.emailConfigs.verify(config.id, { email, code });
await mona.emailConfigs.test(config.id);
console.log(await mona.emailLogs.list({ configId: config.id, status: 'sent' }));
```

Địa chỉ bounce hoặc khiếu nại nằm trong `emailSuppressions.list()`; chỉ gọi `emailSuppressions.remove(email)` sau khi đã sửa nguyên nhân.

## Các nhóm method

| Sub-client | Method |
| --- | --- |
| `keys`, `bankAccounts` | `generate/list/destroy`, `list` |
| `va` | `register/verify/registerNotification/verifyNotification/notificationDetail/list` |
| `paymentProfile`, `checkouts` | `get/set`, `create/get/list/cancel` |
| `qr` | `generate/cancel` |
| `transactions` | `list/iterate/retry` |
| `sandbox` | `transaction` |
| `webhooks`, `webhookLogs` | `list/create/update/remove/test`, `list/stats` |
| `emailConfigs`, `emailLogs`, `emailSuppressions` | `list/get/create/update/remove/verify/resendVerification/test`, `list/stats`, `list/remove` |

Các hàm tiện ích `me()` và `registerVirtualAccount/verifyVirtualAccount/registerNotification/verifyNotification/notificationDetail` cũng gọi trực tiếp được trên client.

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
npm run build && npm test
```

License MIT.
