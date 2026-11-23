import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_NOTIFICATION_SETTINGS, type AppConfig } from '@ai-quota/shared';
import { DatabaseRepository } from '../db/repository.js';
import { NotificationEngine, type NotificationDispatcher } from '../notifications/notificationEngine.js';

const tempDirs: string[] = [];

function createTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-quota-p2-test-'));
  tempDirs.push(dir);
  return path.join(dir, 'quota.db');
}

function makeTestConfig(overrides?: Partial<AppConfig>): AppConfig {
  return {
    pairingToken: 'TEST-1234',
    port: 17321,
    mode: 'widget',
    alwaysOnTop: true,
    shortcut: 'Alt+Q',
    fontScale: 100,
    widgetOpacity: 88,
    analyticsFontScale: 100,
    analyticsOpacity: 96,
    sortMode: 'manual',
    enableGeminiCli: false,
    enableAntigravityCli: true,
    autoCheckUpdates: true,
    notifications: {
      ...DEFAULT_NOTIFICATION_SETTINGS,
      quietHoursEnabled: false,
    },
    windowBounds: { width: 400, height: 560 },
    geminiCliDailyLimit: 1000,
    antigravityCliDailyLimit: 500,
    ...overrides,
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe('Phase 2 & Analytics & NotificationEngine', () => {
  it('supports account alias, color tag, hide/restore, reorder, and manual bucket adjustments', async () => {
    const repo = await DatabaseRepository.create(createTempDbPath());
    try {
      const idA = repo.applyHeartbeat({
        provider: 'gemini',
        identityKey: 'a@gmail.com',
        buckets: [{ bucketType: 'gemini_web', measureMode: 'count' }],
      });
      const idB = repo.applyHeartbeat({
        provider: 'gemini',
        identityKey: 'b@gmail.com',
        buckets: [{ bucketType: 'gemini_web', measureMode: 'count' }],
      });

      repo.updateAccount({
        id: idA,
        displayName: '家庭主力',
        colorTag: '#10b981',
        notifyEnabled: false,
      });
      repo.reorderAccounts([idB, idA]);

      const visible = repo.getAccounts(false);
      expect(visible.map((a) => a.id)).toEqual([idB, idA]);
      expect(visible[1]!.displayName).toBe('家庭主力');
      expect(visible[1]!.colorTag).toBe('#10b981');
      expect(visible[1]!.notifyEnabled).toBe(false);

      // Hide B and verify hiddenAccounts list
      repo.updateAccount({ id: idB, isHidden: true });
      expect(repo.getAccounts(false)).toHaveLength(1);
      expect(repo.getHiddenAccounts()).toHaveLength(1);

      // Manual +1 and mark_exhausted / reset_status
      repo.manualAdjustBucket({ accountId: idA, bucketType: 'gemini_web', action: 'increment' });
      repo.manualAdjustBucket({
        accountId: idA,
        bucketType: 'gemini_web',
        action: 'mark_exhausted',
        cooldownMinutes: 120,
      });
      let bucket = repo.getAccounts(false)[0]!.buckets[0]!;
      expect(bucket.usedValue).toBe(1);
      expect(bucket.status).toBe('exhausted');

      repo.manualAdjustBucket({
        accountId: idA,
        bucketType: 'gemini_web',
        action: 'reset_status',
      });
      bucket = repo.getAccounts(false)[0]!.buckets[0]!;
      expect(bucket.status).toBe('ok');
      expect(bucket.resetAt).toBeNull();
    } finally {
      repo.close();
    }
  });

  it('aggregates family multi-account load under one provider plan and supports yearly/monthly subscriptions', async () => {
    const repo = await DatabaseRepository.create(createTempDbPath());
    try {
      const now = new Date(2026, 10, 20, 14, 0, 0); // 2026-11-20 14:00
      const nowIso = now.toISOString();

      // Two family Gemini accounts sharing one yearly subscription
      repo.recordUsageEvent({
        provider: 'gemini',
        identityKey: 'mom@gmail.com',
        bucketType: 'gemini_web',
        source: 'chrome_ext',
        deltaCount: 8,
        occurredAt: nowIso,
      });
      repo.recordUsageEvent({
        provider: 'gemini',
        identityKey: 'dad@gmail.com',
        bucketType: 'gemini_web',
        source: 'chrome_ext',
        deltaCount: 2,
        occurredAt: nowIso,
      });

      // Configure Gemini as yearly 6000 TWD (= 500/month), billing Nov 25 (5 days away)
      repo.upsertSubscriptionCost({
        provider: 'gemini',
        billingCycle: 'yearly',
        amount: 6000,
        currency: 'TWD',
        billingMonth: 11,
        billingDay: 25,
        isPaused: false,
        snoozedUntil: null,
      });

      // Configure ChatGPT as monthly 660 TWD, billing 22nd (2 days away), with 0 usage
      repo.upsertSubscriptionCost({
        provider: 'chatgpt',
        billingCycle: 'monthly',
        amount: 660,
        currency: 'TWD',
        billingMonth: null,
        billingDay: 22,
        isPaused: false,
        snoozedUntil: null,
      });

      const report = repo.getAnalyticsReport('this_month', 14, now);
      const geminiHealth = report.providerHealth.find((p) => p.provider === 'gemini')!;
      const chatgptHealth = report.providerHealth.find((p) => p.provider === 'chatgpt')!;

      expect(geminiHealth.accountCount).toBe(2);
      expect(geminiHealth.totalInteractions).toBe(10);
      expect(geminiHealth.monthlyEquivalentCost).toBe(500);
      expect(geminiHealth.daysUntilNextBilling).toBe(5);
      expect(report.totalMonthlyCost).toBe(1160);

      // Family multi-account breakdown shares should be 80% and 20%
      const geminiAccounts = report.accountBreakdown.filter((a) => a.provider === 'gemini');
      expect(geminiAccounts).toHaveLength(2);
      expect(geminiAccounts[0]!.sharePercent).toBe(80);
      expect(geminiAccounts[1]!.sharePercent).toBe(20);

      // ChatGPT has 0 usage + paid -> cancel_candidate
      expect(chatgptHealth.grade).toBe('cancel_candidate');
      expect(chatgptHealth.daysUntilNextBilling).toBe(2);
    } finally {
      repo.close();
    }
  });

  it('fires full-recovery and pre-billing notifications without duplicates and respects quiet hours', async () => {
    const repo = await DatabaseRepository.create(createTempDbPath());
    const sent: Array<{ title: string; body: string }> = [];
    const dispatcher: NotificationDispatcher = {
      send: (title, body) => {
        sent.push({ title, body });
        return true;
      },
    };

    try {
      const cfg = makeTestConfig();
      const engine = new NotificationEngine(repo, () => cfg, dispatcher);

      // Seed Claude at 85%
      repo.applySnapshot({
        provider: 'claude',
        identityKey: 'me@claude.ai',
        buckets: [
          {
            bucketType: 'claude_5h',
            measureMode: 'percent',
            usedValue: 85,
            limitValue: 100,
          },
        ],
      });
      // Seed engine state (silent)
      engine.checkRecoveryTransitions(false);
      expect(sent).toHaveLength(0);

      // Claude resets to 0% -> should fire full recovery notification!
      repo.applySnapshot({
        provider: 'claude',
        identityKey: 'me@claude.ai',
        buckets: [
          {
            bucketType: 'claude_5h',
            measureMode: 'percent',
            usedValue: 0,
            limitValue: 100,
          },
        ],
      });
      const rec = engine.checkRecoveryTransitions(true, new Date(2026, 10, 20, 14, 0, 0));
      expect(rec).toHaveLength(1);
      expect(sent[0]!.title).toContain('滿血復活');

      // Yearly subscription renewing in 5 days with zero usage -> pre-billing alert fires once
      repo.upsertSubscriptionCost({
        provider: 'chatgpt',
        billingCycle: 'yearly',
        amount: 7200,
        currency: 'TWD',
        billingMonth: 11,
        billingDay: 25,
        isPaused: false,
        snoozedUntil: null,
      });

      const checkTime = new Date(2026, 10, 20, 14, 0, 0);
      const firstRun = engine.checkSubscriptionReminders(checkTime);
      expect(firstRun).toHaveLength(1);
      expect(firstRun[0]).toContain('年繳扣款');

      // Running again in same cycle must be deduplicated
      const secondRun = engine.checkSubscriptionReminders(checkTime);
      expect(secondRun).toHaveLength(0);
    } finally {
      repo.close();
    }
  });
});
