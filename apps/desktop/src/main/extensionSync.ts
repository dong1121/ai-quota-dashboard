import fs from 'node:fs';
import path from 'node:path';

export interface ExtensionSyncResult {
  synced: boolean;
  targetDir: string;
  version: string | null;
  sourceFound: boolean;
}

function readManifestVersion(dir: string): string | null {
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as { version?: string };
    return typeof parsed.version === 'string' ? parsed.version.trim() : null;
  } catch {
    return null;
  }
}

function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Resolve where the bundled Chrome/Edge extension files live.
 * - Packaged Electron app: <resourcesPath>/chrome-extension (from electron-builder extraResources)
 * - Local dev / monorepo: apps/extension/dist
 */
export function resolveBundledExtensionSource(isPackaged: boolean): string {
  if (isPackaged && typeof process.resourcesPath === 'string') {
    return path.join(process.resourcesPath, 'chrome-extension');
  }
  // dist-electron/main.cjs -> ../../extension/dist
  return path.resolve(__dirname, '../../extension/dist');
}

/**
 * Synchronize bundled extension files into a fixed user data directory
 * (%APPDATA%/AIQuotaDashboard/chrome-extension on Windows) so Chrome/Edge
 * "Load Unpacked" stays automatically up-to-date whenever the Desktop App updates!
 */
export function syncBundledExtension(sourceDir: string, targetDir: string): ExtensionSyncResult {
  if (!fs.existsSync(sourceDir) || !fs.existsSync(path.join(sourceDir, 'manifest.json'))) {
    return {
      synced: false,
      targetDir,
      version: readManifestVersion(targetDir),
      sourceFound: false,
    };
  }

  const srcVersion = readManifestVersion(sourceDir);
  const targetVersion = readManifestVersion(targetDir);

  // Sync whenever target is missing or version changed (or background.js missing)
  const needsSync =
    !targetVersion ||
    targetVersion !== srcVersion ||
    !fs.existsSync(path.join(targetDir, 'background.js'));

  if (needsSync) {
    fs.mkdirSync(targetDir, { recursive: true });
    // Remove stale popup/assets before copying to avoid leftover hashed bundles
    const staleAssets = path.join(targetDir, 'popup', 'assets');
    if (fs.existsSync(staleAssets)) {
      fs.rmSync(staleAssets, { recursive: true, force: true });
    }
    copyDirRecursive(sourceDir, targetDir);
    return {
      synced: true,
      targetDir,
      version: srcVersion,
      sourceFound: true,
    };
  }

  return {
    synced: false,
    targetDir,
    version: targetVersion,
    sourceFound: true,
  };
}
