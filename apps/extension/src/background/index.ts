import type { QuotaSnapshotInput } from '@ai-quota/shared';
import {
  pushHeartbeat,
  pushSnapshot,
  pushUsageEvent,
  verifyPairing,
} from '../shared/apiClient.js';
import {
  getSettings,
  getSyncedServices,
  recordServiceSync,
  saveSettings,
  type ExtensionRuntimeState,
  type ExtensionSettings,
} from '../shared/storage.js';
import type { ExtensionBgMessage } from '../shared/messages.js';

const CLAUDE_POLL_ALARM = 'claude-usage-poll';

let lastConnected = false;
let lastError: string | null = null;

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(CLAUDE_POLL_ALARM, { periodInMinutes: 3 });
  void syncClaudeUsage();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(CLAUDE_POLL_ALARM, { periodInMinutes: 3 });
  void syncClaudeUsage();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CLAUDE_POLL_ALARM) {
    void syncClaudeUsage();
  }
});

function resolveProfileHint(settings: ExtensionSettings): string {
  return settings.profileLabel || settings.profileId;
}

/**
 * Inject probe scripts into already-open Claude / Gemini / ChatGPT tabs
 * so users don't even have to manually refresh open tabs after installing or pairing.
 */
async function scanAlreadyOpenAiTabs(): Promise<{ scannedTabs: number }> {
  const tabs = await chrome.tabs.query({
    url: [
      'https://claude.ai/*',
      'https://gemini.google.com/*',
      'https://chatgpt.com/*',
      'https://chat.openai.com/*',
    ],
  });

  let scannedTabs = 0;
  for (const tab of tabs) {
    if (!tab.id || !tab.url) continue;
    let bridgeFile: string | null = null;
    if (tab.url.startsWith('https://claude.ai/')) {
      bridgeFile = 'content/bridge-claude.js';
    } else if (tab.url.startsWith('https://gemini.google.com/')) {
      bridgeFile = 'content/bridge-gemini.js';
    } else if (
      tab.url.startsWith('https://chatgpt.com/') ||
      tab.url.startsWith('https://chat.openai.com/')
    ) {
      bridgeFile = 'content/bridge-chatgpt.js';
    }
    if (!bridgeFile) continue;

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content/net-interceptor.js'],
        world: 'MAIN',
      });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: [bridgeFile],
        world: 'ISOLATED',
      });
      scannedTabs += 1;
    } catch {
      // Ignore restricted or discarded tabs
    }
  }

  return { scannedTabs };
}

/**
 * Quietly queries Claude's web session endpoints using the browser's existing cookie.
 * Works even when the user only uses Claude Desktop (Cowork) or Mobile, as long as
 * they signed into claude.ai once in this Chrome Profile.
 */
async function syncClaudeUsage(): Promise<{ ok: boolean; reason?: string }> {
  const settings = await getSettings();
  if (!settings.pairingToken) {
    return { ok: false, reason: 'no_pairing_token' };
  }

  try {
    const orgsRes = await fetch('https://claude.ai/api/organizations', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });

    if (orgsRes.status === 401 || orgsRes.status === 403) {
      return { ok: false, reason: 'not_logged_in' };
    }
    if (!orgsRes.ok) {
      return { ok: false, reason: `orgs_http_${orgsRes.status}` };
    }

    const orgs = (await orgsRes.json()) as Array<{
      uuid?: string;
      name?: string;
      capabilities?: string[];
    }>;
    if (!Array.isArray(orgs) || orgs.length === 0) {
      return { ok: false, reason: 'no_org' };
    }

    // Prefer chat/pro org over API-only org when available
    const activeOrg =
      orgs.find((o) => o.capabilities?.includes('chat')) ?? orgs[0]!;
    if (!activeOrg.uuid) {
      return { ok: false, reason: 'missing_org_uuid' };
    }

    // Try to resolve account email for clean display name (optional)
    let email: string | null = null;
    try {
      const acctRes = await fetch('https://claude.ai/api/auth/current_account', {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (acctRes.ok) {
        const acctJson = (await acctRes.json()) as {
          email_address?: string;
          email?: string;
        };
        email = acctJson.email_address || acctJson.email || null;
      }
    } catch {
      // Optional endpoint; ignore failure
    }

    const usageRes = await fetch(
      `https://claude.ai/api/organizations/${activeOrg.uuid}/usage`,
      {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      },
    );

    if (!usageRes.ok) {
      return { ok: false, reason: `usage_http_${usageRes.status}` };
    }

    const usage = (await usageRes.json()) as {
      five_hour?: { utilization?: number; resets_at?: string | null };
      seven_day?: { utilization?: number; resets_at?: string | null };
    };

    const buckets: QuotaSnapshotInput['buckets'] = [];
    if (usage.five_hour && typeof usage.five_hour.utilization === 'number') {
      buckets.push({
        bucketType: 'claude_5h',
        label: '5h 額度',
        measureMode: 'percent',
        usedValue: normalizePercent(usage.five_hour.utilization),
        limitValue: 100,
        resetAt: usage.five_hour.resets_at ?? null,
      });
    }
    if (usage.seven_day && typeof usage.seven_day.utilization === 'number') {
      buckets.push({
        bucketType: 'claude_weekly',
        label: '每週額度',
        measureMode: 'percent',
        usedValue: normalizePercent(usage.seven_day.utilization),
        limitValue: 100,
        resetAt: usage.seven_day.resets_at ?? null,
      });
    }

    if (buckets.length === 0) {
      return { ok: false, reason: 'empty_usage_payload' };
    }

    const identityKey = email || `claude-org-${activeOrg.uuid.slice(0, 8)}`;
    const pushed = await pushSnapshot(settings, {
      provider: 'claude',
      identityKey,
      profileHint: resolveProfileHint(settings),
      buckets,
    });

    lastConnected = pushed;
    if (pushed) {
      lastError = null;
      await recordServiceSync({
        provider: 'claude',
        identityKey,
        lastSyncedAt: new Date().toISOString(),
        note: `5h: ${buckets[0]?.usedValue ?? 0}%`,
      });
    }
    return { ok: pushed };
  } catch {
    return { ok: false, reason: 'network_error' };
  }
}

function normalizePercent(val: number): number {
  // Handle both 0-100 scale and 0-1 fractional scale safely
  if (val > 0 && val <= 1) {
    return Math.round(val * 100);
  }
  return Math.max(0, Math.min(100, Math.round(val)));
}

chrome.runtime.onMessage.addListener(
  (message: ExtensionBgMessage, _sender, sendResponse) => {
    void (async () => {
      const settings = await getSettings();
      const profileHint = resolveProfileHint(settings);

      switch (message.type) {
        case 'REPORT_HEARTBEAT': {
          const payload = { ...message.payload, profileHint };
          const ok = await pushHeartbeat(settings, payload);
          lastConnected = ok;
          if (ok) {
            lastError = null;
            await recordServiceSync({
              provider: payload.provider,
              identityKey: payload.identityKey,
              lastSyncedAt: new Date().toISOString(),
            });
          }
          sendResponse({ ok });
          break;
        }

        case 'REPORT_SNAPSHOT': {
          const payload = { ...message.payload, profileHint };
          const ok = await pushSnapshot(settings, payload);
          lastConnected = ok;
          if (ok) {
            lastError = null;
            await recordServiceSync({
              provider: payload.provider,
              identityKey: payload.identityKey,
              lastSyncedAt: new Date().toISOString(),
            });
          }
          sendResponse({ ok });
          break;
        }

        case 'REPORT_EVENT': {
          const payload = { ...message.payload, profileHint };
          const ok = await pushUsageEvent(settings, payload);
          lastConnected = ok;
          if (ok) {
            lastError = null;
            await recordServiceSync({
              provider: payload.provider,
              identityKey: payload.identityKey,
              lastSyncedAt: new Date().toISOString(),
            });
          }
          sendResponse({ ok });
          break;
        }

        case 'TRIGGER_CLAUDE_SYNC': {
          const res = await syncClaudeUsage();
          sendResponse(res);
          break;
        }

        case 'SCAN_OPEN_TABS': {
          const tabRes = await scanAlreadyOpenAiTabs();
          const claudeRes = await syncClaudeUsage();
          sendResponse({ scannedTabs: tabRes.scannedTabs, claudeOk: claudeRes.ok });
          break;
        }

        case 'SAVE_AND_TEST_SETTINGS': {
          const nextSettings = await saveSettings(message.settings);
          const verify = await verifyPairing(nextSettings);
          lastConnected = verify.ok;
          lastError = verify.ok ? null : (verify.error ?? '連線失敗');
          if (verify.ok) {
            await scanAlreadyOpenAiTabs();
            void syncClaudeUsage();
          }
          const state: ExtensionRuntimeState = {
            settings: nextSettings,
            connected: lastConnected,
            lastError,
            services: await getSyncedServices(),
          };
          sendResponse(state);
          break;
        }

        case 'GET_POPUP_STATE': {
          if (settings.pairingToken) {
            const verify = await verifyPairing(settings);
            lastConnected = verify.ok;
            lastError = verify.ok ? null : (verify.error ?? null);
          } else {
            lastConnected = false;
            lastError = null;
          }
          const state: ExtensionRuntimeState = {
            settings,
            connected: lastConnected,
            lastError,
            services: await getSyncedServices(),
          };
          sendResponse(state);
          break;
        }
      }
    })();

    return true;
  },
);
