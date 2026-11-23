import {
  DEFAULT_LOCAL_HOST,
  PAIRING_HEADER,
  type HeartbeatInput,
  type PairVerifyResponse,
  type QuotaSnapshotInput,
  type UsageEventInput,
} from '@ai-quota/shared';
import type { ExtensionSettings } from './storage.js';

function baseUrl(settings: ExtensionSettings): string {
  return `http://${DEFAULT_LOCAL_HOST}:${settings.port}`;
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
