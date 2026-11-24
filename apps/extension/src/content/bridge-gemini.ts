import { detectRateLimitFromText, parseApiRateLimit } from '@ai-quota/shared';
import {
  NET_EVENT_SOURCE,
  type ExtensionBgMessage,
  type MainWorldNetEvent,
} from '../shared/messages.js';

const GUARD_KEY = '__aiQuotaBridgeGeminiInstalled';
const SEEN_CONVS_KEY = '__aiQuotaSeenGeminiConvs';
const win = window as unknown as Record<string, unknown>;
let cachedEmail: string | null = null;
let lastDesktopPromptMs = 0;

function sendToBg(msg: ExtensionBgMessage): void {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

function discoverGoogleEmail(): string | null {
  if (cachedEmail) return cachedEmail;

  const selectors = [
    'a[aria-label*="@"]',
    'button[aria-label*="@"]',
    'img[alt*="@"]',
    '[data-email]',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const candidate =
      el.getAttribute('data-email') ||
      el.getAttribute('aria-label') ||
      el.getAttribute('alt') ||
      '';
    const match = candidate.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (match?.[0]) {
      cachedEmail = match[0].toLowerCase();
      return cachedEmail;
    }
  }

  return null;
}

function registerHeartbeat(): void {
  const email = discoverGoogleEmail();
  sendToBg({
    type: 'REPORT_HEARTBEAT',
    payload: {
      provider: 'gemini',
      identityKey: email ?? 'gemini-web-profile',
      buckets: [
        {
          bucketType: 'gemini_web',
          measureMode: 'count',
        },
      ],
    },
  });
}

// Always report heartbeat on load / re-injection
setTimeout(registerHeartbeat, 1000);
setTimeout(() => {
  if (!cachedEmail) registerHeartbeat();
}, 3500);

/**
 * Lightweight Mobile Delta Sync for Gemini Web:
 * Detects newly appeared sidebar conversation IDs created on mobile
 * when returning to desktop Chrome.
 */
function runGeminiMobileDeltaSync(): void {
  try {
    const links = Array.from(document.querySelectorAll('a[href*="/app/"]'));
    const convIds: string[] = [];
    for (const el of links) {
      const href = el.getAttribute('href') ?? '';
      const m = href.match(/\/app\/([a-zA-Z0-9_-]{8,})/);
      if (m?.[1] && !convIds.includes(m[1])) {
        convIds.push(m[1]);
      }
      if (convIds.length >= 25) break;
    }
    if (convIds.length === 0) return;

    const raw = localStorage.getItem(SEEN_CONVS_KEY);
    if (!raw) {
      localStorage.setItem(SEEN_CONVS_KEY, JSON.stringify(convIds));
      return;
    }

    const seen = new Set<string>(JSON.parse(raw) as string[]);
    const identityKey = discoverGoogleEmail() ?? 'gemini-web-profile';
    const isRecentDesktopPrompt = Date.now() - lastDesktopPromptMs < 60_000;

    let added = false;
    for (const id of convIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      added = true;
      if (!isRecentDesktopPrompt) {
        sendToBg({
          type: 'REPORT_EVENT',
          payload: {
            provider: 'gemini',
            identityKey,
            bucketType: 'gemini_web',
            measureMode: 'count',
            source: 'mobile_delta',
            modelName: 'gemini-mobile-delta',
            deltaCount: 1,
            occurredAt: new Date().toISOString(),
            externalEventId: `gemini-delta:${id}`,
          },
        });
      }
    }

    if (added) {
      localStorage.setItem(SEEN_CONVS_KEY, JSON.stringify(Array.from(seen).slice(-80)));
    }
  } catch {
    // silent fallback
  }
}

setTimeout(runGeminiMobileDeltaSync, 4500);

if (!win[GUARD_KEY]) {
  win[GUARD_KEY] = true;

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data as MainWorldNetEvent | undefined;
    if (!data || data.source !== NET_EVENT_SOURCE || data.provider !== 'gemini') return;

    if (data.kind === 'session' && data.email) {
      cachedEmail = data.email.toLowerCase();
      registerHeartbeat();
      return;
    }

    const identityKey = discoverGoogleEmail() ?? 'gemini-web-profile';

    if (data.kind === 'prompt') {
      lastDesktopPromptMs = Date.now();
      sendToBg({
        type: 'REPORT_EVENT',
        payload: {
          provider: 'gemini',
          identityKey,
          bucketType: 'gemini_web',
          measureMode: 'count',
          source: 'chrome_ext',
          modelName: data.modelSlug ?? 'gemini-web',
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
          provider: 'gemini',
          identityKey,
          bucketType: 'gemini_web',
          measureMode: 'count',
          source: 'chrome_ext',
          deltaCount: 0,
          statusOverride: 'exhausted',
          resetAt: parsed.resetAt,
        },
      });
    }
  });

  // Multilingual DOM fallback detector for Gemini limit/downgrade banners + user prompt bubble fallback
  let lastDomCheck = 0;
  let lastReportedLimitAt = 0;
  let seenUserQueryCount = document.querySelectorAll('user-query, [data-test-id="user-query"]').length;

  const observer = new MutationObserver(() => {
    const now = Date.now();
    if (now - lastDomCheck < 2000) return;
    lastDomCheck = now;

    if (!cachedEmail) {
      const found = discoverGoogleEmail();
      if (found) registerHeartbeat();
    }

    // Fallback user-query bubble counter if Google changes RPC URLs
    const currentQueries = document.querySelectorAll('user-query, [data-test-id="user-query"]').length;
    if (currentQueries > seenUserQueryCount) {
      const delta = currentQueries - seenUserQueryCount;
      seenUserQueryCount = currentQueries;
      // Only fire fallback if XHR/fetch interceptor did not already record a prompt within 4 seconds
      if (delta === 1 && now - lastDesktopPromptMs > 4000) {
        lastDesktopPromptMs = now;
        sendToBg({
          type: 'REPORT_EVENT',
          payload: {
            provider: 'gemini',
            identityKey: discoverGoogleEmail() ?? 'gemini-web-profile',
            bucketType: 'gemini_web',
            measureMode: 'count',
            source: 'chrome_ext',
            modelName: 'gemini-web-dom',
            deltaCount: 1,
            occurredAt: new Date(now).toISOString(),
          },
        });
      }
    } else if (currentQueries < seenUserQueryCount) {
      // User switched conversations
      seenUserQueryCount = currentQueries;
    }

    if (now - lastReportedLimitAt < 60_000) return;

    const banners = document.querySelectorAll(
      '[role="alert"], [role="status"], snack-bar-container, .mdc-snackbar__label',
    );
    for (const el of banners) {
      const text = el.textContent?.trim() ?? '';
      const parsed = detectRateLimitFromText(text, now);
      if (parsed.isRateLimited || parsed.status === 'warning') {
        lastReportedLimitAt = now;
        sendToBg({
          type: 'REPORT_EVENT',
          payload: {
            provider: 'gemini',
            identityKey: discoverGoogleEmail() ?? 'gemini-web-profile',
            bucketType: 'gemini_web',
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
