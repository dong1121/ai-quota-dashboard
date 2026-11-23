import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const child = spawn(String(electronPath), ['.'], {
  cwd: rootDir,
  stdio: 'inherit',
  detached: false,
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
