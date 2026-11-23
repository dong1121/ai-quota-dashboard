import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

await Promise.all([
  build({
    entryPoints: [path.join(rootDir, 'src/main/index.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outfile: path.join(rootDir, 'dist-electron/main.cjs'),
    external: ['electron', 'electron-updater', 'sql.js', 'chokidar'],
    sourcemap: true,
  }),
  build({
    entryPoints: [path.join(rootDir, 'src/preload/index.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outfile: path.join(rootDir, 'dist-electron/preload.cjs'),
    external: ['electron'],
    sourcemap: true,
  }),
]);

console.log('[desktop] Electron main & preload built successfully.');
