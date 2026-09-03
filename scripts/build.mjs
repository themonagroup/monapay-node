import { copyFile, mkdir, writeFile } from 'node:fs/promises';

await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
await copyFile(new URL('../src/index.cjs', import.meta.url), new URL('../dist/index.cjs', import.meta.url));
await copyFile(new URL('../src/index.d.ts', import.meta.url), new URL('../dist/index.d.ts', import.meta.url));
await writeFile(
  new URL('../dist/index.js', import.meta.url),
  "import sdk from './index.cjs';\n\nexport const { MonaPay, MonaPayError, verifyWebhook, expressWebhook } = sdk;\nexport default MonaPay;\n",
);
