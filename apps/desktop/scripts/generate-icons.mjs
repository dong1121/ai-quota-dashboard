import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.resolve(__dirname, '../build');
fs.mkdirSync(buildDir, { recursive: true });

// Generate 512x512 PNG for macOS & Linux, and ICO (wrapping 256x256 PNG) for Windows
const png512 = createBadgePng(512);
const png256 = createBadgePng(256);

fs.writeFileSync(path.join(buildDir, 'icon.png'), png512);
fs.writeFileSync(path.join(buildDir, 'icon.ico'), wrapPngAsIco(png256));
console.log('[desktop] Generated build/icon.png (512x512) and build/icon.ico (256x256).');

function wrapPngAsIco(pngBuf) {
  // Valid Windows ICO container with single 256x256 embedded PNG entry
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = ICO
  header.writeUInt16LE(1, 4); // count: 1 image

  const dirEntry = Buffer.alloc(16);
  dirEntry[0] = 0; // 0 means 256px width
  dirEntry[1] = 0; // 0 means 256px height
  dirEntry[2] = 0; // color palette
  dirEntry[3] = 0; // reserved
  dirEntry.writeUInt16LE(1, 4); // color planes
  dirEntry.writeUInt16LE(32, 6); // bits per pixel
  dirEntry.writeUInt32LE(pngBuf.length, 8); // size of PNG data
  dirEntry.writeUInt32LE(22, 12); // offset = 6 + 16

  return Buffer.concat([header, dirEntry, pngBuf]);
}

function createBadgePng(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.44;

  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
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

        if (dist > radius * 0.54 && dist < radius * 0.72 && dy < radius * 0.24) {
          r = 255;
          g = 255;
          b = 255;
          a = 242;
        } else if (dist <= radius * 0.2) {
          r = 255;
          g = 255;
          b = 255;
          a = 255;
        } else if (dist > radius - 2) {
          a = Math.max(0, Math.min(255, Math.round(((radius - dist) / 2) * 255)));
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
  ihdr[8] = 8;
  ihdr[9] = 6;

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
