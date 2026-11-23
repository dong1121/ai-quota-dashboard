import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const extDist = path.join(rootDir, 'apps', 'extension', 'dist');
const releaseDir = path.join(rootDir, 'release');

const rootPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));
const version = rootPkg.version || '0.3.0';

if (!fs.existsSync(extDist)) {
  throw new Error('apps/extension/dist not found. Run npm run build:extension first.');
}

fs.mkdirSync(releaseDir, { recursive: true });
const outZip = path.join(releaseDir, `AI-Quota-Chrome-Extension-v${version}.zip`);
if (fs.existsSync(outZip)) fs.unlinkSync(outZip);

if (process.platform === 'win32') {
  // Windows 10/11 built-in bsdtar supports -a (.zip) without PowerShell wildcard bracket issues
  execFileSync('tar.exe', ['-a', '-cf', outZip, '-C', extDist, '.'], { stdio: 'inherit' });
} else {
  execFileSync('zip', ['-r', outZip, '.'], { cwd: extDist, stdio: 'inherit' });
}

const sizeKb = Math.round(fs.statSync(outZip).size / 1024);
console.log(`[release] Packed Chrome Extension to ${outZip} (${sizeKb} KB)`);
