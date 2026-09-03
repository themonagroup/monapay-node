# Changelog

## 0.5.0

- Thêm `paymentProfile.get/set` và `checkouts.create/get/list/cancel` cho hosted checkout.
- Tự sinh `Idempotency-Key` cho thao tác tạo và huỷ checkout, cho phép truyền key riêng.

## 0.4.0 - 2026-09-03

- Thêm `emailConfigs`, `emailLogs`, `emailSuppressions` và type declarations cho toàn bộ Email API.
- Thêm nguồn chuẩn trong `src/` và lệnh build tái tạo package ESM/CJS.

## 0.3.0 - 2026-09-03

- Hoàn thiện luồng nối ngân hàng ACB bằng OTP 4 bước và truy vấn trạng thái đăng ký thông báo.

## 0.2.0 - 2026-09-03

- Thêm OAuth client credentials qua `clientId` + `clientSecret` và `MonaPay.fromEnv()`.
- Cache token theo `expires_in`, làm mới sớm 60 giây; giữ tương thích username/password.

## 0.1.0 - 2026-08-29

- Bản đầu tiên: auth tự động, VA, VietQR, giao dịch, webhook configs/logs và retry.
- Xác thực webhook HMAC-SHA256, middleware Express và ví dụ Next.js.
- ESM, CommonJS và TypeScript declarations; zero-dependency.
