import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { build as viteBuild } from 'vite';
import { build as esbuild } from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

fs.mkdirSync(distDir, { recursive: true });

// 1. Build Popup React UI via Vite
await viteBuild({
  configFile: path.join(rootDir, 'vite.config.ts'),
});

// 2. Build Service Worker + Content Scripts as standalone bundles
const scriptTargets = [
  { entry: 'src/background/index.ts', out: 'background.js', format: 'esm' },
  { entry: 'src/content/net-interceptor.ts', out: 'content/net-interceptor.js', format: 'iife' },
  { entry: 'src/content/bridge-claude.ts', out: 'content/bridge-claude.js', format: 'iife' },
  { entry: 'src/content/bridge-gemini.ts', out: 'content/bridge-gemini.js', format: 'iife' },
  { entry: 'src/content/bridge-chatgpt.ts', out: 'content/bridge-chatgpt.js', format: 'iife' },
];

await Promise.all(
  scriptTargets.map((target) =>
    esbuild({
      entryPoints: [path.join(rootDir, target.entry)],
      bundle: true,
      format: target.format,
      target: 'chrome120',
      outfile: path.join(distDir, target.out),
      sourcemap: false,
      minify: true,
    }),
  ),
);

// 3. Copy manifest.json
fs.copyFileSync(
  path.join(rootDir, 'public/manifest.json'),
  path.join(distDir, 'manifest.json'),
);

// 4. Generate crisp PNG icons (16, 48, 128) without external binary dependencies
const iconsDir = path.join(distDir, 'icons');
fs.mkdirSync(iconsDir, { recursive: true });
for (const size of [16, 48, 128]) {
  fs.writeFileSync(path.join(iconsDir, `icon${size}.png`), createBadgePng(size));
}

console.log('[extension] Chrome MV3 extension built to apps/extension/dist');

function createBadgePng(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.44;

  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filter type 0
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const px = rowStart + 1 + x * 4;

      if (dist <= radius) {
        const t = Math.min(1, Math.max(0, (x + y) / (size * 2)));
        let r = Math.round(99 * (1 - t) + 56 * t);
        let g = Math.round(102 * (1 - t) + 189 * t);
        let b = Math.round(241 * (1 - t) + 248 * t);
        let a = 255;

        // White inner ring arc
        if (dist > radius * 0.52 && dist < radius * 0.72 && dy < radius * 0.25) {
          r = 255;
          g = 255;
          b = 255;
          a = 240;
        } else if (dist <= radius * 0.22) {
          r = 255;
          g = 255;
          b = 255;
          a = 255;
        } else if (dist > radius - 1.2) {
          a = Math.max(0, Math.min(255, Math.round(((radius - dist) / 1.2) * 255)));
        }

        raw[px] = r;
        raw[px + 1] = g;
        raw[px + 2] = b;
        raw[px + 3] = a;
      }
    }
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}
