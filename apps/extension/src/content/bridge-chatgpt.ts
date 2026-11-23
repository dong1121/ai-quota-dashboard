import {
  classifyChatGptModel,
  detectRateLimitFromText,
  parseApiRateLimit,
} from '@ai-quota/shared';
import {
  NET_EVENT_SOURCE,
  type ExtensionBgMessage,
  type MainWorldNetEvent,
} from '../shared/messages.js';

const GUARD_KEY = '__aiQuotaBridgeChatGptInstalled';
const DELTA_SYNC_KEY = '__aiQuotaChatGptDeltaMs';
const win = window as unknown as Record<string, unknown>;
let cachedEmail: string | null = null;
let lastDesktopPromptMs = 0;

function sendToBg(msg: ExtensionBgMessage): void {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

async function fetchChatGptSessionEmail(): Promise<string | null> {
  if (cachedEmail) return cachedEmail;
  try {
    const res = await fetch('/api/auth/session', { credentials: 'include' });
    if (!res.ok) return null;
    const json = (await res.json()) as { user?: { email?: string } };
    if (json?.user?.email) {
      cachedEmail = json.user.email.toLowerCase();
      return cachedEmail;
    }
  } catch {
    // ignore
  }
  return null;
}

async function registerHeartbeat(): Promise<void> {
  const email = await fetchChatGptSessionEmail();
  sendToBg({
    type: 'REPORT_HEARTBEAT',
    payload: {
      provider: 'chatgpt',
      identityKey: email ?? 'chatgpt-profile',
      buckets: [
        {
          bucketType: 'chatgpt_general',
          measureMode: 'count',
        },
      ],
    },
  });
}

// Always trigger heartbeat on load / re-injection
setTimeout(() => {
  void registerHeartbeat();
}, 900);

/**
 * Lightweight Mobile Delta Sync:
 * Inspects recent ChatGPT conversation timestamps when returning to desktop,
 * recording newly updated conversations created outside this browser session.
 */
async function runMobileDeltaSync(): Promise<void> {
  try {
    const email = await fetchChatGptSessionEmail();
    const res = await fetch('/backend-api/conversations?offset=0&limit=12&order=updated', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return;
    const data = (await res.json()) as {
      items?: Array<{ id?: string; update_time?: number | string }>;
    };
    const items = data?.items;
    if (!Array.isArray(items) || items.length === 0) return;

    const nowMs = Date.now();
    const prevRaw = localStorage.getItem(DELTA_SYNC_KEY);
    if (!prevRaw) {
      // Seed watermark on first run without backfilling historical conversations
      localStorage.setItem(DELTA_SYNC_KEY, String(nowMs));
      return;
    }

    const prevMs = Number(prevRaw) || nowMs;
    let maxSeenMs = prevMs;
    const identityKey = email ?? 'chatgpt-profile';

    for (const item of items) {
      if (!item.id || !item.update_time) continue;
      const updateMs =
        typeof item.update_time === 'number'
          ? item.update_time * 1000
          : Date.parse(item.update_time);
      if (Number.isNaN(updateMs) || updateMs <= prevMs) continue;
      if (updateMs > maxSeenMs) maxSeenMs = updateMs;

      // Skip conversations updated immediately around a desktop prompt
      if (Math.abs(updateMs - lastDesktopPromptMs) < 90_000) continue;

      const minuteBucket = Math.floor(updateMs / 60_000);
      sendToBg({
        type: 'REPORT_EVENT',
        payload: {
          provider: 'chatgpt',
          identityKey,
          bucketType: 'chatgpt_general',
          measureMode: 'count',
          source: 'mobile_delta',
          modelName: 'chatgpt-mobile-delta',
          deltaCount: 1,
          occurredAt: new Date(updateMs).toISOString(),
          externalEventId: `chatgpt-delta:${item.id}:${minuteBucket}`,
        },
      });
    }

    localStorage.setItem(DELTA_SYNC_KEY, String(Math.max(nowMs, maxSeenMs)));
  } catch {
    // Silent fallback
  }
}

setTimeout(() => {
  void runMobileDeltaSync();
}, 4200);

if (!win[GUARD_KEY]) {
  win[GUARD_KEY] = true;

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data as MainWorldNetEvent | undefined;
    if (!data || data.source !== NET_EVENT_SOURCE || data.provider !== 'chatgpt') return;

    if (data.kind === 'session' && data.email) {
      cachedEmail = data.email.toLowerCase();
      void registerHeartbeat();
      return;
    }

    const identityKey = cachedEmail ?? 'chatgpt-profile';
    const bucketType = classifyChatGptModel(data.modelSlug);

    if (data.kind === 'prompt') {
      lastDesktopPromptMs = Date.now();
      sendToBg({
        type: 'REPORT_EVENT',
        payload: {
          provider: 'chatgpt',
          identityKey,
          bucketType,
          measureMode: 'count',
          source: 'chrome_ext',
          modelName: data.modelSlug ?? 'chatgpt',
          deltaCount: 1,
          occurredAt: data.timestamp,
        },
      });
      return;
    }

    if (data.kind === 'rate_limit') {
      const parsed = parseApiRateLimit(data.httpStatus, data.headers, data.body);
      sendToBg({
        type: 'REPORT_EVENT',
        payload: {
          provider: 'chatgpt',
          identityKey,
          bucketType,
          measureMode: 'count',
          source: 'chrome_ext',
          modelName: data.modelSlug ?? 'chatgpt',
          deltaCount: 0,
          statusOverride: 'exhausted',
          resetAt: parsed.resetAt,
        },
      });
    }
  });

  // Multilingual DOM fallback observer
  let lastDomCheck = 0;
  let lastReportedLimitAt = 0;

  const observer = new MutationObserver(() => {
    const now = Date.now();
    if (now - lastDomCheck < 5000) return;
    lastDomCheck = now;
    if (now - lastReportedLimitAt < 60_000) return;

    const alerts = document.querySelectorAll('[role="alert"], [data-testid*="limit"], .toast');
    for (const el of alerts) {
      const text = el.textContent?.trim() ?? '';
      const parsed = detectRateLimitFromText(text, now);
      if (parsed.isRateLimited || parsed.status === 'warning') {
        lastReportedLimitAt = now;
        sendToBg({
          type: 'REPORT_EVENT',
          payload: {
            provider: 'chatgpt',
            identityKey: cachedEmail ?? 'chatgpt-profile',
            bucketType: 'chatgpt_reasoning',
            measureMode: 'count',
            source: 'chrome_ext',
            deltaCount: 0,
            statusOverride: parsed.status,
            resetAt: parsed.resetAt,
          },
        });
        break;
      }
    }
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }
}
