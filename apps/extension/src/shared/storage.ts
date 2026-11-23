import { DEFAULT_LOCAL_PORT, type ProviderType } from '@ai-quota/shared';

export interface ExtensionSettings {
  pairingToken: string;
  port: number;
  profileId: string;
  profileLabel: string;
}

export interface ServiceSyncRecord {
  provider: ProviderType;
  identityKey: string;
  lastSyncedAt: string;
  note?: string;
}

export interface ExtensionRuntimeState {
  settings: ExtensionSettings;
  connected: boolean;
  lastError: string | null;
  services: Partial<Record<ProviderType, ServiceSyncRecord>>;
}

const STORAGE_KEY_SETTINGS = 'ai_quota_settings';
const STORAGE_KEY_SERVICES = 'ai_quota_services';

function randomProfileId(): string {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return `P-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

export async function getSettings(): Promise<ExtensionSettings> {
  const data = await chrome.storage.local.get(STORAGE_KEY_SETTINGS);
  const saved = (data[STORAGE_KEY_SETTINGS] ?? {}) as Partial<ExtensionSettings>;
  const profileId = saved.profileId || randomProfileId();

  const merged: ExtensionSettings = {
    pairingToken: saved.pairingToken ?? '',
    port: typeof saved.port === 'number' && saved.port > 0 ? saved.port : DEFAULT_LOCAL_PORT,
    profileId,
    profileLabel: saved.profileLabel ?? '',
  };

  if (!saved.profileId) {
    await chrome.storage.local.set({ [STORAGE_KEY_SETTINGS]: merged });
  }
  return merged;
}

export async function saveSettings(patch: Partial<ExtensionSettings>): Promise<ExtensionSettings> {
  const current = await getSettings();
  const next: ExtensionSettings = {
    ...current,
    ...patch,
    pairingToken: (patch.pairingToken ?? current.pairingToken).trim(),
    profileLabel: (patch.profileLabel ?? current.profileLabel).trim(),
  };
  await chrome.storage.local.set({ [STORAGE_KEY_SETTINGS]: next });
  return next;
}

export async function getSyncedServices(): Promise<Partial<Record<ProviderType, ServiceSyncRecord>>> {
  const data = await chrome.storage.local.get(STORAGE_KEY_SERVICES);
  return (data[STORAGE_KEY_SERVICES] ?? {}) as Partial<Record<ProviderType, ServiceSyncRecord>>;
}

export async function recordServiceSync(rec: ServiceSyncRecord): Promise<void> {
  const services = await getSyncedServices();
  services[rec.provider] = rec;
  await chrome.storage.local.set({ [STORAGE_KEY_SERVICES]: services });
}
