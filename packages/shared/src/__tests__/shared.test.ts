import { describe, expect, it } from 'vitest';
import {
  classifyChatGptModel,
  computeBucketStatus,
  computeDaysUntilNextBilling,
  computeMonthlyEquivalent,
  detectRateLimitFromText,
  evaluateSubscriptionHealth,
  formatCountdown,
  isWithinQuietHours,
  maskEmail,
  normalizeIdentityKey,
  parseApiRateLimit,
  parseGeminiAppHtml,
} from '../index.js';

describe('@ai-quota/shared', () => {
  it('normalizes and masks emails consistently', () => {
    expect(normalizeIdentityKey('  User.Name@Gmail.COM ')).toBe('user.name@gmail.com');
    expect(maskEmail('dong1121.ai@gmail.com')).toBe('don***@gmail.com');
    expect(maskEmail('ab@gmail.com')).toBe('a***@gmail.com');
  });

  it('computes quota statuses and auto-recovers expired cooldowns', () => {
    const now = Date.parse('2026-11-20T10:00:00Z');
    expect(computeBucketStatus('percent', 40, 100, null, undefined, now)).toBe('ok');
    expect(computeBucketStatus('percent', 80, 100, null, undefined, now)).toBe('warning');
    expect(computeBucketStatus('percent', 98, 100, '2026-11-20T12:00:00Z', undefined, now)).toBe(
      'exhausted',
    );
    // Past reset time should recover to ok
    expect(computeBucketStatus('percent', 98, 100, '2026-11-20T09:00:00Z', undefined, now)).toBe(
      'ok',
    );
  });

  it('formats countdown cleanly', () => {
    const now = Date.parse('2026-11-20T10:00:00Z');
    expect(formatCountdown('2026-11-20T12:14:00Z', now)).toBe('2h 14m 後重置');
    expect(formatCountdown('2026-11-20T09:59:00Z', now)).toBe('已重置');
  });

  it('parses HTTP 429 and JSON rate limits', () => {
    const now = Date.parse('2026-11-20T10:00:00Z');
    const res = parseApiRateLimit(
      429,
      { 'Retry-After': '3600' },
      { detail: { code: 'rate_limit_reached', clears_in: 7200 } },
      now,
    );
    expect(res.isRateLimited).toBe(true);
    expect(res.status).toBe('exhausted');
    expect(res.resetAt).toBe('2026-11-20T12:00:00.000Z');
  });

  it('supports multilingual DOM fallback detection', () => {
    const now = Date.parse('2026-11-20T10:00:00Z');
    const zhTw = detectRateLimitFromText('您已達到使用上限，請在 2 小時 15 分鐘後再試。', now);
    expect(zhTw.isRateLimited).toBe(true);
    expect(zhTw.resetAt).toBe('2026-11-20T12:15:00.000Z');

    const en = detectRateLimitFromText("You've reached your usage limit. Try again in 1 hour.", now);
    expect(en.isRateLimited).toBe(true);
    expect(en.resetAt).toBe('2026-11-20T11:00:00.000Z');
  });

  it('classifies ChatGPT model slugs', () => {
    expect(classifyChatGptModel('o3-mini')).toBe('chatgpt_reasoning');
    expect(classifyChatGptModel('gpt-5-thinking')).toBe('chatgpt_reasoning');
    expect(classifyChatGptModel('deep-research-v1')).toBe('chatgpt_deep_research');
    expect(classifyChatGptModel('gpt-4o')).toBe('chatgpt_general');
  });

  it('computes monthly/yearly billing countdown and subscription health', () => {
    expect(computeMonthlyEquivalent(6000, 'yearly')).toBe(500);
    expect(computeMonthlyEquivalent(660, 'monthly')).toBe(660);

    const now = new Date(2026, 10, 20); // 2026-11-20
    expect(computeDaysUntilNextBilling('monthly', 23, null, now)).toBe(3);
    expect(computeDaysUntilNextBilling('yearly', 27, 11, now)).toBe(7);
    expect(computeDaysUntilNextBilling('yearly', 10, 1, now)).toBe(51);

    const health = evaluateSubscriptionHealth({
      provider: 'chatgpt',
      isPaused: false,
      activeDays: 1,
      periodDays: 30,
      totalInteractions: 3,
      daysSinceLastActive: 16,
      avgWeeklyUtilization: null,
      monthlyEquivalentCost: 660,
      daysUntilNextBilling: 3,
      idleDaysThreshold: 14,
    });
    expect(health.grade).toBe('cancel_candidate');

    // Fresh Day-1 install on the 24th of the month with active Claude Cowork weekly utilization
    const freshClaudeActive = evaluateSubscriptionHealth({
      provider: 'claude',
      isPaused: false,
      activeDays: 1,
      periodDays: 24,
      trackedDays: 1,
      totalInteractions: 0,
      daysSinceLastActive: 0,
      avgWeeklyUtilization: 48,
      monthlyEquivalentCost: 660,
      daysUntilNextBilling: 5,
      idleDaysThreshold: 14,
    });
    expect(freshClaudeActive.grade).toBe('great');

    // Fresh Day-1 install with low initial usage should show observation grace period, NOT cancel_candidate
    const freshClaudeLow = evaluateSubscriptionHealth({
      provider: 'claude',
      isPaused: false,
      activeDays: 1,
      periodDays: 24,
      trackedDays: 1,
      totalInteractions: 0,
      daysSinceLastActive: 0,
      avgWeeklyUtilization: 8,
      monthlyEquivalentCost: 660,
      daysUntilNextBilling: 5,
      idleDaysThreshold: 14,
    });
    expect(freshClaudeLow.grade).toBe('no_data');

    expect(isWithinQuietHours(23, 23, 8)).toBe(true);
    expect(isWithinQuietHours(2, 23, 8)).toBe(true);
    expect(isWithinQuietHours(10, 23, 8)).toBe(false);
  });

  it('parses Gemini Wiz HTML for signed-in email and conversation IDs', () => {
    const mockHtml = `
      <script>window.WIZ_global_data = {"oPEP7c":"Friend.Pro@gmail.com","other":"x"};</script>
      <div data-items='["c_1a2b3c4d5e6f7890","c_abcdef1234567890"]'>
        <a href="/app/1a2b3c4d5e6f7890">dup</a>
        <a href="/app/9988776655443322">new</a>
      </div>
    `;
    const parsed = parseGeminiAppHtml(mockHtml);
    expect(parsed.email).toBe('friend.pro@gmail.com');
    expect(parsed.conversationIds).toEqual([
      '1a2b3c4d5e6f7890',
      'abcdef1234567890',
      '9988776655443322',
    ]);
  });
});
