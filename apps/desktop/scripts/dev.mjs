import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// 1. Build main & preload
await import('./build-electron.mjs');

// 2. Start Vite renderer dev server
const vite = await createServer({
  configFile: path.join(rootDir, 'vite.config.ts'),
});
await vite.listen();
const address = vite.resolvedUrls?.local[0] ?? 'http://localhost:5178';
console.log(`[desktop] Vite renderer listening on ${address}`);

// 3. Launch Electron
const child = spawn(String(electronPath), ['.'], {
  cwd: rootDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: address,
  },
});

child.on('exit', async (code) => {
  await vite.close();
  process.exit(code ?? 0);
});
