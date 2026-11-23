import { NET_EVENT_SOURCE, type MainWorldNetEvent } from '../shared/messages.js';

/**
 * Runs in Chrome MV3 MAIN world at document_start.
 * Non-invasively observes window.fetch responses for AI API endpoints
 * (never blocks, alters, or exports cookies/passwords).
 */
(() => {
  const GUARD_KEY = '__aiQuotaNetInterceptorInstalled';
  const win = window as unknown as Record<string, unknown>;
  if (win[GUARD_KEY]) return;
  win[GUARD_KEY] = true;

  const originalFetch = window.fetch.bind(window);
  const host = window.location.hostname;

  function emit(event: Omit<MainWorldNetEvent, 'source' | 'timestamp'>): void {
    window.postMessage(
      {
        ...event,
        source: NET_EVENT_SOURCE,
        timestamp: new Date().toISOString(),
      } satisfies MainWorldNetEvent,
      '*',
    );
  }

  // On Gemini Web, expose signed-in email from Google's WIZ_global_data (language-agnostic)
  if (host.includes('gemini.google.com')) {
    const checkWizEmail = () => {
      try {
        const wiz = (window as unknown as { WIZ_global_data?: Record<string, unknown> })
          .WIZ_global_data;
        const rawEmail = wiz?.oPEP7c;
        if (typeof rawEmail === 'string' && rawEmail.includes('@')) {
          emit({
            provider: 'gemini',
            kind: 'session',
            httpStatus: 200,
            url: window.location.href,
            email: rawEmail.trim().toLowerCase(),
          });
          return true;
        }
      } catch {
        // ignore
      }
      return false;
    };
    if (!checkWizEmail()) {
      setTimeout(checkWizEmail, 1200);
      setTimeout(checkWizEmail, 3500);
    }
  }

  function extractHeaders(headers: Headers): Record<string, string> {
    const out: Record<string, string> = {};
    for (const key of [
      'retry-after',
      'x-ratelimit-reset',
      'x-ratelimit-reset-requests',
      'anthropic-ratelimit-requests-reset',
    ]) {
      const val = headers.get(key);
      if (val) out[key] = val;
    }
    return out;
  }

  function tryExtractModelFromBody(body: BodyInit | null | undefined): string | null {
    if (typeof body !== 'string' || body.length > 500_000) return null;
    try {
      const parsed = JSON.parse(body) as { model?: unknown };
      if (typeof parsed.model === 'string') return parsed.model;
    } catch {
      // Not JSON (e.g. URL-encoded Gemini RPC payload)
    }
    return null;
  }

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();

    const response = await originalFetch(input, init);

    try {
      // 1. ChatGPT (chatgpt.com / chat.openai.com)
      if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) {
        if (url.includes('/api/auth/session') && response.ok) {
          response
            .clone()
            .json()
            .then((json: { user?: { email?: string } }) => {
              if (json?.user?.email) {
                emit({
                  provider: 'chatgpt',
                  kind: 'session',
                  httpStatus: response.status,
                  url,
                  email: json.user.email,
                });
              }
            })
            .catch(() => {});
        } else if (
          method === 'POST' &&
          (url.includes('/backend-api/conversation') || url.includes('/backend-api/f/conversation'))
        ) {
          const modelSlug = tryExtractModelFromBody(init?.body);
          if (response.status === 429) {
            response
              .clone()
              .json()
              .then((body) => {
                emit({
                  provider: 'chatgpt',
                  kind: 'rate_limit',
                  httpStatus: response.status,
                  url,
                  modelSlug,
                  headers: extractHeaders(response.headers),
                  body,
                });
              })
              .catch(() => {
                emit({
                  provider: 'chatgpt',
                  kind: 'rate_limit',
                  httpStatus: response.status,
                  url,
                  modelSlug,
                  headers: extractHeaders(response.headers),
                });
              });
          } else if (response.ok) {
            emit({
              provider: 'chatgpt',
              kind: 'prompt',
              httpStatus: response.status,
              url,
              modelSlug,
            });
          }
        }
      }

      // 2. Gemini Web (gemini.google.com)
      if (host.includes('gemini.google.com')) {
        const isGenerateCall =
          method === 'POST' &&
          (url.includes('StreamGenerate') ||
            url.includes('BardFrontendService') ||
            url.includes('GenerateContent'));

        if (isGenerateCall) {
          if (response.status === 429) {
            emit({
              provider: 'gemini',
              kind: 'rate_limit',
              httpStatus: response.status,
              url,
              headers: extractHeaders(response.headers),
            });
          } else if (response.ok) {
            emit({
              provider: 'gemini',
              kind: 'prompt',
              httpStatus: response.status,
              url,
            });
          }
        }
      }

      // 3. Claude (claude.ai)
      if (host.includes('claude.ai')) {
        if (url.includes('/api/organizations/') && url.includes('/usage') && response.ok) {
          response
            .clone()
            .json()
            .then((body) => {
              emit({
                provider: 'claude',
                kind: 'claude_usage',
                httpStatus: response.status,
                url,
                body,
              });
            })
            .catch(() => {});
        } else if (
          method === 'POST' &&
          url.includes('/completion') &&
          response.status === 429
        ) {
          response
            .clone()
            .json()
            .then((body) => {
              emit({
                provider: 'claude',
                kind: 'rate_limit',
                httpStatus: response.status,
                url,
                headers: extractHeaders(response.headers),
                body,
              });
            })
            .catch(() => {
              emit({
                provider: 'claude',
                kind: 'rate_limit',
                httpStatus: response.status,
                url,
                headers: extractHeaders(response.headers),
              });
            });
        }
      }
    } catch {
      // Never break host page fetch
    }

    return response;
  };
})();
