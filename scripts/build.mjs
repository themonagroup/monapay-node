import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';

await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
await copyFile(new URL('../src/index.cjs', import.meta.url), new URL('../dist/index.cjs', import.meta.url));
await copyFile(new URL('../src/index.d.ts', import.meta.url), new URL('../dist/index.d.ts', import.meta.url));

const commonJsSource = await readFile(new URL('../src/index.cjs', import.meta.url), 'utf8');
const cryptoRequire = "const { createHmac, randomUUID, timingSafeEqual } = require('node:crypto');";
const commonJsExports = 'module.exports = { MonaPay, MonaPayError, verifyWebhook, expressWebhook };';
if (!commonJsSource.includes(cryptoRequire) || !commonJsSource.includes(commonJsExports)) {
  throw new Error('Không thể chuyển source CommonJS sang ESM');
}
const esmSource = commonJsSource
  .replace("'use strict';\n\n", '')
  .replace(cryptoRequire, "import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';")
  .replace(commonJsExports, 'export { MonaPay, MonaPayError, verifyWebhook, expressWebhook };\nexport default MonaPay;');
await writeFile(new URL('../dist/index.js', import.meta.url), esmSource);
