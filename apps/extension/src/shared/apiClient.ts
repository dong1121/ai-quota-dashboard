import {
  DEFAULT_LOCAL_HOST,
  PAIRING_HEADER,
  type HeartbeatInput,
  type PairVerifyResponse,
  type QuotaSnapshotInput,
  type UsageEventInput,
} from '@ai-quota/shared';
import type { ExtensionSettings } from './storage.js';

const RELOAD_GUARD_KEY = 'ai_quota_auto_reloaded_for';
let detectedNewerServerExtVersion: string | null = null;

function baseUrl(settings: ExtensionSettings): string {
  return `http://${DEFAULT_LOCAL_HOST}:${settings.port}`;
}

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function getNewerServerExtensionVersion(): string | null {
  return detectedNewerServerExtVersion;
}

/**
 * If the Desktop App updated and refreshed %APPDATA%/AIQuotaDashboard/chrome-extension,
 * automatically trigger chrome.runtime.reload() ONCE so Chrome loads the updated
 * unpacked extension files with zero manual steps!
 */
async function maybeAutoReloadFromServerHeader(serverExtVersion: string | null): Promise<void> {
  if (!serverExtVersion) return;
  const currentVersion = chrome.runtime.getManifest().version;
  if (compareSemver(serverExtVersion, currentVersion) <= 0) {
    detectedNewerServerExtVersion = null;
    return;
  }

  detectedNewerServerExtVersion = serverExtVersion;
  const stored = await chrome.storage.local.get(RELOAD_GUARD_KEY);
  if (stored[RELOAD_GUARD_KEY] === serverExtVersion) {
    // Already attempted reload once for this version (user likely loaded from an old manual folder)
    return;
  }

  await chrome.storage.local.set({ [RELOAD_GUARD_KEY]: serverExtVersion });
  setTimeout(() => {
    chrome.runtime.reload();
  }, 500);
}

export async function verifyPairing(
  settings: ExtensionSettings,
): Promise<{ ok: boolean; error?: string; data?: PairVerifyResponse }> {
  if (!settings.pairingToken) {
    return { ok: false, error: '請輸入桌面小工具顯示的配對碼' };
  }
  try {
    const res = await fetch(`${baseUrl(settings)}/api/pair/verify`, {
      method: 'POST',
      headers: {
        [PAIRING_HEADER]: settings.pairingToken,
      },
    });
    if (res.status === 401) {
      return { ok: false, error: '配對碼錯誤，請確認與桌面小工具一致' };
    }
    if (!res.ok) {
      return { ok: false, error: `本機服務回傳錯誤 (${res.status})` };
    }
    const data = (await res.json()) as PairVerifyResponse;
    const serverExtVer = res.headers.get('x-extension-version') || data.extensionVersion || null;
    void maybeAutoReloadFromServerHeader(serverExtVer);
    return { ok: true, data };
  } catch {
    return { ok: false, error: '無法連線本機桌面小工具，請確認程式已啟動' };
  }
}

async function postAuthorized(
  settings: ExtensionSettings,
  path: string,
  body: unknown,
): Promise<boolean> {
  if (!settings.pairingToken) return false;
  try {
    const res = await fetch(`${baseUrl(settings)}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [PAIRING_HEADER]: settings.pairingToken,
      },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      void maybeAutoReloadFromServerHeader(res.headers.get('x-extension-version'));
    }
    return res.ok;
  } catch {
    return false;
  }
}

export function pushHeartbeat(settings: ExtensionSettings, payload: HeartbeatInput): Promise<boolean> {
  return postAuthorized(settings, '/api/ingest/heartbeat', payload);
}

export function pushSnapshot(
  settings: ExtensionSettings,
  payload: QuotaSnapshotInput,
): Promise<boolean> {
  return postAuthorized(settings, '/api/ingest/snapshot', payload);
}

export function pushUsageEvent(
  settings: ExtensionSettings,
  payload: UsageEventInput,
): Promise<boolean> {
  return postAuthorized(settings, '/api/ingest/event', payload);
}
