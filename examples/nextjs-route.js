import { verifyWebhook } from '@monapay/node';

export async function POST(request) {
  const rawBody = new Uint8Array(await request.arrayBuffer());
  const result = verifyWebhook({
    rawBody,
    headers: request.headers,
    secret: process.env.MONA_WEBHOOK_SECRET,
  });
  if (!result.ok) {
    return Response.json({ ok: false, reason: result.reason }, { status: 401 });
  }

  // Dùng transaction_code làm UNIQUE key trước khi cập nhật đơn hàng.
  await saveMonaPayTransaction(result.payload);
  return Response.json({ ok: true });
}

async function saveMonaPayTransaction(payload) {
  console.log(payload.transaction_code);
}
