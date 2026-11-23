import electron from 'electron';
import {
  PROVIDER_META,
  isWithinQuietHours,
  type AppConfig,
  type QuotaStatus,
} from '@ai-quota/shared';
import type { DatabaseRepository } from '../db/repository.js';

interface BucketSnapshotState {
  status: QuotaStatus;
  usedValue: number;
  resetAt: string | null;
}

export interface NotificationDispatcher {
  send(title: string, body: string): boolean;
}

class ElectronToastDispatcher implements NotificationDispatcher {
  send(title: string, body: string): boolean {
    const NotifCtor =
      typeof electron === 'object' && electron !== null ? electron.Notification : undefined;
    if (!NotifCtor || !NotifCtor.isSupported()) return false;
    const notif = new NotifCtor({
      title,
      body,
      silent: false,
    });
    notif.show();
    return true;
  }
}

export class NotificationEngine {
  private readonly repository: DatabaseRepository;
  private readonly getConfig: () => AppConfig;
  private readonly dispatcher: NotificationDispatcher;
  private readonly prevBucketStates = new Map<string, BucketSnapshotState>();
  private recoveryTimer: NodeJS.Timeout | null = null;
  private healthTimer: NodeJS.Timeout | null = null;
  private initialized = false;

  constructor(
    repository: DatabaseRepository,
    getConfig: () => AppConfig,
    dispatcher?: NotificationDispatcher,
  ) {
    this.repository = repository;
    this.getConfig = getConfig;
    this.dispatcher = dispatcher ?? new ElectronToastDispatcher();
  }

  start(): void {
    // Seed initial bucket states without firing spurious alerts on startup
    this.checkRecoveryTransitions(false);
    this.initialized = true;

    this.recoveryTimer = setInterval(() => {
      this.checkRecoveryTransitions(true);
    }, 60_000);

    // Run subscription low-usage & pre-billing check 12s after boot, then every 4 hours
    setTimeout(() => {
      this.checkSubscriptionReminders();
    }, 12_000);

    this.healthTimer = setInterval(() => {
      this.checkSubscriptionReminders();
    }, 4 * 60 * 60_000);
  }

  stop(): void {
    if (this.recoveryTimer) {
      clearInterval(this.recoveryTimer);
      this.recoveryTimer = null;
    }
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  private canNotifyNow(nowDate: Date = new Date()): boolean {
    const cfg = this.getConfig().notifications;
    if (!cfg.enabled) return false;
    if (cfg.quietHoursEnabled) {
      if (isWithinQuietHours(nowDate.getHours(), cfg.quietStartHour, cfg.quietEndHour)) {
        return false;
      }
    }
    return true;
  }

  onRepositoryChanged(): void {
    if (!this.initialized) return;
    this.checkRecoveryTransitions(true);
  }

  checkRecoveryTransitions(allowNotify = true, nowDate: Date = new Date()): string[] {
    const sentTitles: string[] = [];
    const cfg = this.getConfig().notifications;
    const accounts = this.repository.getAccounts(false);

    for (const account of accounts) {
      for (const bucket of account.buckets) {
        const key = `${account.id}:${bucket.bucketType}`;
        const prev = this.prevBucketStates.get(key);
        this.prevBucketStates.set(key, {
          status: bucket.status,
          usedValue: bucket.usedValue,
          resetAt: bucket.resetAt,
        });

        if (!prev || !allowNotify || !account.notifyEnabled) continue;
        if (!cfg.fullRecoveryEnabled || !this.canNotifyNow(nowDate)) continue;

        const recoveredFromCooldown = prev.status === 'exhausted' && bucket.status === 'ok';
        const claudeReset =
          (bucket.bucketType === 'claude_5h' || bucket.bucketType === 'claude_weekly') &&
          prev.usedValue >= 30 &&
          bucket.usedValue <= 10;

        if (recoveredFromCooldown || claudeReset) {
          const title = `✨ ${account.displayName} 滿血復活！`;
          const body = `${PROVIDER_META[account.provider].name}「${bucket.label}」額度已重置，可以繼續開工。`;
          this.dispatcher.send(title, body);
          sentTitles.push(title);
        }
      }
    }

    return sentTitles;
  }

  checkSubscriptionReminders(nowDate: Date = new Date()): string[] {
    const sentTitles: string[] = [];
    const cfg = this.getConfig().notifications;
    if (!cfg.lowUsageEnabled || !this.canNotifyNow(nowDate)) return sentTitles;

    const report = this.repository.getAnalyticsReport('this_month', cfg.idleDaysThreshold, nowDate);
    const yearMonth = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, '0')}`;
    const nowMs = nowDate.getTime();

    for (const item of report.providerHealth) {
      const sub = item.subscription;
      if (sub.isPaused) continue;
      if (sub.snoozedUntil && Date.parse(sub.snoozedUntil) > nowMs) continue;
      if (item.accountCount === 0 && sub.amount <= 0) continue;

      const providerName = PROVIDER_META[item.provider].name;

      // 1. Pre-billing health check (supports monthly & yearly cycles!)
      if (item.daysUntilNextBilling !== null) {
        const remindWindow =
          sub.billingCycle === 'yearly'
            ? cfg.yearlyRemindDaysBefore
            : cfg.monthlyRemindDaysBefore;

        if (
          item.daysUntilNextBilling <= remindWindow &&
          (item.grade === 'cancel_candidate' || item.grade === 'low')
        ) {
          const cycleKey = sub.billingCycle === 'yearly' ? String(nowDate.getFullYear()) : yearMonth;
          const notifKey = `prebill:${item.provider}:${cycleKey}`;
          if (!this.repository.hasNotificationSent(notifKey)) {
            const cycleLabel = sub.billingCycle === 'yearly' ? '年繳' : '月繳';
            const costText = sub.amount > 0 ? `（${sub.currency} ${sub.amount.toLocaleString()}）` : '';
            const title = `💡 ${providerName} 即將${cycleLabel}扣款`;
            const body = `距扣款剩 ${item.daysUntilNextBilling} 天${costText}，本月${item.headline}，建議打開統計頁評估是否續訂。`;
            this.dispatcher.send(title, body);
            this.repository.markNotificationSent(notifKey, 'pre_billing');
            sentTitles.push(title);
            continue;
          }
        }
      }

      // 2. Idle days reminder (max once per month per provider)
      if (
        item.daysSinceLastActive !== null &&
        item.daysSinceLastActive >= cfg.idleDaysThreshold &&
        sub.amount > 0
      ) {
        const notifKey = `idle:${item.provider}:${yearMonth}`;
        if (!this.repository.hasNotificationSent(notifKey)) {
          const title = `💤 ${providerName} 已閒置 ${item.daysSinceLastActive} 天`;
          const body = `此付費方案已超過 ${cfg.idleDaysThreshold} 天未使用，可於統計頁檢視 CP 值或標記暫停追蹤。`;
          this.dispatcher.send(title, body);
          this.repository.markNotificationSent(notifKey, 'idle_warning');
          sentTitles.push(title);
        }
      }
    }

    return sentTitles;
  }

  sendTestNotification(kind: 'recovery' | 'low_usage' = 'recovery'): {
    ok: boolean;
    message: string;
  } {
    const title =
      kind === 'low_usage'
        ? '💡 ChatGPT Plus 即將月繳扣款（測試）'
        : '✨ Claude 5h 額度滿血復活！（測試）';
    const body =
      kind === 'low_usage'
        ? '距扣款剩 3 天（TWD 660），本月使用率偏低，可點開統計頁評估是否暫停續訂。'
        : '您的 Claude 5 小時額度已重置歸零，可以繼續開工囉！';

    const ok = this.dispatcher.send(title, body);
    return ok
      ? { ok: true, message: '已送出 Windows 系統通知（若未彈出，請檢查 Windows 勿擾模式或通知權限）' }
      : { ok: false, message: '目前系統不支援原生通知' };
  }
}
