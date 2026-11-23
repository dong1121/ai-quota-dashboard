import {
  detectRateLimitFromText,
  parseApiRateLimit,
  type QuotaSnapshotInput,
} from '@ai-quota/shared';
import {
  NET_EVENT_SOURCE,
  type ExtensionBgMessage,
  type MainWorldNetEvent,
} from '../shared/messages.js';

const GUARD_KEY = '__aiQuotaBridgeClaudeInstalled';
const win = window as unknown as Record<string, unknown>;

function sendToBg(msg: ExtensionBgMessage): void {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

function normalizePercent(val: number): number {
  if (val > 0 && val <= 1) {
    return Math.round(val * 100);
  }
  return Math.max(0, Math.min(100, Math.round(val)));
}

/**
 * Fetch Claude real 5h & weekly usage directly in same-origin page context
 * so Cloudflare / browser session headers match 100%.
 */
async function syncClaudeFromPage(): Promise<void> {
  try {
    const orgsRes = await fetch('/api/organizations', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!orgsRes.ok) {
      // Fallback: ask background worker to try too
      sendToBg({ type: 'TRIGGER_CLAUDE_SYNC' });
      return;
    }

    const orgs = (await orgsRes.json()) as Array<{
      uuid?: string;
      name?: string;
      capabilities?: string[];
    }>;
    if (!Array.isArray(orgs) || orgs.length === 0) return;

    const activeOrg = orgs.find((o) => o.capabilities?.includes('chat')) ?? orgs[0]!;
    if (!activeOrg.uuid) return;

    let email: string | null = null;
    try {
      const acctRes = await fetch('/api/auth/current_account', {
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
      // optional
    }

    const identityKey = email || `claude-org-${activeOrg.uuid.slice(0, 8)}`;

    // Always register heartbeat so card appears immediately
    sendToBg({
      type: 'REPORT_HEARTBEAT',
      payload: {
        provider: 'claude',
        identityKey,
        buckets: [
          { bucketType: 'claude_5h', label: '5h 額度', measureMode: 'percent', limitValue: 100 },
          { bucketType: 'claude_weekly', label: '每週額度', measureMode: 'percent', limitValue: 100 },
        ],
      },
    });

    const usageRes = await fetch(`/api/organizations/${activeOrg.uuid}/usage`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!usageRes.ok) return;

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

    if (buckets.length > 0) {
      sendToBg({
        type: 'REPORT_SNAPSHOT',
        payload: {
          provider: 'claude',
          identityKey,
          buckets,
        },
      });
    }
  } catch {
    sendToBg({ type: 'TRIGGER_CLAUDE_SYNC' });
  }
}

// Always trigger an immediate sync (also runs when re-injected by SCAN_OPEN_TABS)
setTimeout(() => {
  void syncClaudeFromPage();
}, 800);

if (!win[GUARD_KEY]) {
  win[GUARD_KEY] = true;

  // Periodic same-origin refresh while tab stays open
  setInterval(() => {
    if (document.visibilityState === 'visible') {
      void syncClaudeFromPage();
    }
  }, 180_000);

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data as MainWorldNetEvent | undefined;
    if (!data || data.source !== NET_EVENT_SOURCE || data.provider !== 'claude') return;

    if (data.kind === 'claude_usage') {
      void syncClaudeFromPage();
      return;
    }

    if (data.kind === 'rate_limit') {
      const parsed = parseApiRateLimit(data.httpStatus, data.headers, data.body);
      if (parsed.isRateLimited) {
        sendToBg({
          type: 'REPORT_EVENT',
          payload: {
            provider: 'claude',
            identityKey: 'claude-active',
            bucketType: 'claude_5h',
            measureMode: 'percent',
            source: 'chrome_ext',
            deltaCount: 0,
            statusOverride: 'exhausted',
            resetAt: parsed.resetAt,
          },
        });
        void syncClaudeFromPage();
      }
    }
  });

  // Multilingual DOM fallback observer (throttled)
  let lastDomCheck = 0;
  const observer = new MutationObserver(() => {
    const now = Date.now();
    if (now - lastDomCheck < 8000) return;
    lastDomCheck = now;

    const alertEls = document.querySelectorAll('[role="alert"], [data-testid*="limit"], .toast');
    for (const el of alertEls) {
      const text = el.textContent?.trim() ?? '';
      const parsed = detectRateLimitFromText(text, now);
      if (parsed.isRateLimited) {
        void syncClaudeFromPage();
        break;
      }
    }
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }
}
