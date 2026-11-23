import type { BucketType, QuotaStatus } from './types.js';

export interface ParsedRateLimit {
  isRateLimited: boolean;
  status: QuotaStatus;
  resetAt: string | null;
  reason?: string;
}

/**
 * Classify a ChatGPT model slug into a clean quota bucket.
 */
export function classifyChatGptModel(modelSlug?: string | null): BucketType {
  const m = (modelSlug ?? '').toLowerCase();
  if (!m) return 'chatgpt_general';
  if (m.includes('deep-research') || m.includes('deep_research') || m.includes('research')) {
    return 'chatgpt_deep_research';
  }
  if (m.includes('image') || m.includes('dalle') || m.includes('dall-e')) {
    return 'chatgpt_image';
  }
  if (
    m.startsWith('o1') ||
    m.startsWith('o3') ||
    m.startsWith('o4') ||
    m.includes('thinking') ||
    m.includes('reason') ||
    m.includes('pro')
  ) {
    return 'chatgpt_reasoning';
  }
  return 'chatgpt_general';
}

/**
 * Parse rate-limit metadata from HTTP status, headers, and API JSON body.
 * Prioritizes machine-readable HTTP/JSON fields over UI text (i18n safe).
 */
export function parseApiRateLimit(
  httpStatus: number,
  headers?: Record<string, string | null | undefined>,
  body?: unknown,
  nowMs: number = Date.now(),
): ParsedRateLimit {
  const normalizedHeaders: Record<string, string> = {};
  if (headers) {
    for (const [k, v] of Object.entries(headers)) {
      if (v != null) normalizedHeaders[k.toLowerCase()] = String(v);
    }
  }

  let resetMs: number | null = null;

  // 1. Check standard Retry-After header (seconds or HTTP date)
  const retryAfter = normalizedHeaders['retry-after'];
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (!Number.isNaN(secs) && secs > 0) {
      resetMs = nowMs + secs * 1000;
    } else {
      const parsedDate = Date.parse(retryAfter);
      if (!Number.isNaN(parsedDate)) resetMs = parsedDate;
    }
  }

  // 2. Check x-ratelimit-reset* headers
  if (!resetMs) {
    const resetHeader =
      normalizedHeaders['x-ratelimit-reset-requests'] ||
      normalizedHeaders['x-ratelimit-reset'] ||
      normalizedHeaders['anthropic-ratelimit-requests-reset'];
    if (resetHeader) {
      const isoMs = Date.parse(resetHeader);
      if (!Number.isNaN(isoMs)) {
        resetMs = isoMs;
      } else {
        const durMs = parseDurationStringToMs(resetHeader);
        if (durMs) resetMs = nowMs + durMs;
      }
    }
  }

  // 3. Check JSON body fields (ChatGPT / Claude / Gemini RPC)
  let bodyIndicatesLimit = false;
  let reason: string | undefined;

  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    const detail = (obj.detail && typeof obj.detail === 'object'
      ? obj.detail
      : obj.error && typeof obj.error === 'object'
        ? obj.error
        : obj) as Record<string, unknown>;

    const clearsIn = Number(detail.clears_in ?? detail.resets_after ?? obj.clears_in);
    if (!Number.isNaN(clearsIn) && clearsIn > 0) {
      resetMs = nowMs + clearsIn * 1000;
      bodyIndicatesLimit = true;
    }

    const resetsAtRaw =
      (typeof detail.resets_at === 'string' && detail.resets_at) ||
      (typeof detail.reset_at === 'string' && detail.reset_at) ||
      (typeof obj.resets_at === 'string' && obj.resets_at);
    if (resetsAtRaw) {
      const parsed = Date.parse(resetsAtRaw);
      if (!Number.isNaN(parsed)) {
        resetMs = parsed;
      }
    }

    const code = String(detail.code ?? detail.type ?? obj.code ?? '').toLowerCase();
    const message = String(detail.message ?? obj.message ?? '');
    if (
      code.includes('rate_limit') ||
      code.includes('quota') ||
      code.includes('too_many') ||
      code.includes('resource_exhausted') ||
      detail.rate_limit_reached === true
    ) {
      bodyIndicatesLimit = true;
      reason = message || code;
    }
  }

  const isRateLimited = httpStatus === 429 || bodyIndicatesLimit;
  if (!isRateLimited) {
    return { isRateLimited: false, status: 'ok', resetAt: null };
  }

  return {
    isRateLimited: true,
    status: 'exhausted',
    resetAt: resetMs ? new Date(resetMs).toISOString() : null,
    reason,
  };
}

/**
 * Multilingual DOM text fallback detector (zh-TW / zh-CN / EN).
 * Only used as secondary fallback when API interception doesn't capture a banner.
 */
const EXHAUSTED_PATTERNS: RegExp[] = [
  // Traditional Chinese
  /已達.*?(上限|限額|次數限制)/i,
  /暫時無法使用.*?(模型|功能)/i,
  /已超過.*?(使用限制|配額)/i,
  /請在.*?後再試/i,
  // Simplified Chinese
  /已达.*?(上限|限额|次数限制)/i,
  /暂时无法使用.*?(模型|功能)/i,
  /已超出.*?(使用限制|配额)/i,
  // English
  /you['’]?ve reached (your|the) (usage |message |current )?limit/i,
  /usage limit reached/i,
  /rate limit exceeded/i,
  /too many requests/i,
  /temporarily switched to/i,
];

const WARNING_PATTERNS: RegExp[] = [
  /即將達到.*?(上限|限制)/i,
  /即将达到.*?(上限|限制)/i,
  /approaching (your|the) limit/i,
  /remaining messages/i,
  /剩餘.*?\d+.*?則/i,
];

export function detectRateLimitFromText(
  text: string,
  nowMs: number = Date.now(),
): ParsedRateLimit {
  if (!text || text.length > 4000) {
    return { isRateLimited: false, status: 'ok', resetAt: null };
  }

  const isExhausted = EXHAUSTED_PATTERNS.some((re) => re.test(text));
  const isWarning = !isExhausted && WARNING_PATTERNS.some((re) => re.test(text));

  if (!isExhausted && !isWarning) {
    return { isRateLimited: false, status: 'ok', resetAt: null };
  }

  const resetAt = extractResetTimeFromText(text, nowMs);
  return {
    isRateLimited: isExhausted,
    status: isExhausted ? 'exhausted' : 'warning',
    resetAt,
    reason: 'dom_fallback',
  };
}

export function extractResetTimeFromText(text: string, nowMs: number = Date.now()): string | null {
  // Match relative durations independently: "2 hours 30 minutes", "3 小時", "45 分鐘", "1h 20m"
  const hrsMatch = text.match(/(\d+)\s*(?:hours?|hrs?|h(?![a-z])|小時|小时)/i);
  const minsMatch = text.match(/(\d+)\s*(?:minutes?|mins?|m(?![a-z])|分鐘|分钟)/i);
  if (hrsMatch || minsMatch) {
    const hrs = Number(hrsMatch?.[1] ?? 0);
    const mins = Number(minsMatch?.[1] ?? 0);
    const totalMs = (hrs * 60 + mins) * 60_000;
    if (totalMs > 0) {
      return new Date(nowMs + totalMs).toISOString();
    }
  }

  // Match clock times: "after 5:30 PM", "17:30 後", "下午 5:30"
  const clockMatch = text.match(/(上午|下午|AM|PM)?\s*(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (clockMatch) {
    let hour = Number(clockMatch[2]);
    const minute = Number(clockMatch[3]);
    const meridiem = (clockMatch[1] || clockMatch[4] || '').toUpperCase();
    if ((meridiem === 'PM' || meridiem === '下午') && hour < 12) hour += 12;
    if ((meridiem === 'AM' || meridiem === '上午') && hour === 12) hour = 0;
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      const candidate = new Date(nowMs);
      candidate.setHours(hour, minute, 0, 0);
      if (candidate.getTime() <= nowMs) {
        candidate.setDate(candidate.getDate() + 1);
      }
      return candidate.toISOString();
    }
  }

  return null;
}

function parseDurationStringToMs(raw: string): number | null {
  const match = raw.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?/i);
  if (!match || (!match[1] && !match[2] && !match[3])) return null;
  const h = Number(match[1] ?? 0);
  const m = Number(match[2] ?? 0);
  const s = Number(match[3] ?? 0);
  const total = ((h * 60 + m) * 60 + s) * 1000;
  return total > 0 ? total : null;
}
