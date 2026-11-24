import { NET_EVENT_SOURCE, type MainWorldNetEvent } from '../shared/messages.js';

/**
 * Runs in Chrome/Edge MV3 MAIN world at document_start.
 * Non-invasively observes both window.fetch AND XMLHttpRequest responses
 * (Google Wiz / Gemini uses XMLHttpRequest for StreamGenerate RPCs!).
 */
(() => {
  const GUARD_KEY = '__aiQuotaNetInterceptorInstalled';
  const win = window as unknown as Record<string, unknown>;
  if (win[GUARD_KEY]) return;
  win[GUARD_KEY] = true;

  const originalFetch = window.fetch.bind(window);
  const host = window.location.hostname;
  let lastGeminiPromptEmitMs = 0;

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

  function isGeminiGenerateUrl(url: string): boolean {
    return (
      url.includes('StreamGenerate') ||
      url.includes('BardFrontendService') ||
      url.includes('GenerateContent')
    );
  }

  function emitGeminiPromptDebounced(url: string, status: number): void {
    const now = Date.now();
    if (now - lastGeminiPromptEmitMs < 2500) return;
    lastGeminiPromptEmitMs = now;
    emit({
      provider: 'gemini',
      kind: 'prompt',
      httpStatus: status,
      url,
    });
  }

  // On Gemini Web / Chrome & Edge PWA, expose signed-in email from Google's WIZ_global_data
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

    // Hook XMLHttpRequest for Google Closure XhrIo (used by Gemini StreamGenerate)
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (
      this: XMLHttpRequest & { __aiQuotaMethod?: string; __aiQuotaUrl?: string },
      method: string,
      url: string | URL,
      ...rest: unknown[]
    ) {
      this.__aiQuotaMethod = String(method || 'GET').toUpperCase();
      this.__aiQuotaUrl = typeof url === 'string' ? url : url.href;
      return origOpen.apply(this, [method, url, ...rest] as Parameters<typeof origOpen>);
    };

    XMLHttpRequest.prototype.send = function (
      this: XMLHttpRequest & { __aiQuotaMethod?: string; __aiQuotaUrl?: string },
      body?: Document | XMLHttpRequestBodyInit | null,
    ) {
      const method = this.__aiQuotaMethod ?? 'GET';
      const url = this.__aiQuotaUrl ?? '';
      if (method === 'POST' && isGeminiGenerateUrl(url)) {
        this.addEventListener('loadend', () => {
          try {
            if (this.status === 429) {
              const retryAfter = this.getResponseHeader('retry-after');
              emit({
                provider: 'gemini',
                kind: 'rate_limit',
                httpStatus: 429,
                url,
                headers: retryAfter ? { 'retry-after': retryAfter } : undefined,
              });
            } else if (this.status >= 200 && this.status < 300) {
              emitGeminiPromptDebounced(url, this.status);
            }
          } catch {
            // never break host XHR
          }
        });
      }
      return origSend.call(this, body);
    };
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
      // Not JSON
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

      // 2. Gemini Web / PWA (gemini.google.com)
      if (host.includes('gemini.google.com')) {
        if (method === 'POST' && isGeminiGenerateUrl(url)) {
          if (response.status === 429) {
            emit({
              provider: 'gemini',
              kind: 'rate_limit',
              httpStatus: response.status,
              url,
              headers: extractHeaders(response.headers),
            });
          } else if (response.ok) {
            emitGeminiPromptDebounced(url, response.status);
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
