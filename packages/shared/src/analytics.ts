import type {
  AccountDTO,
  BillingCycle,
  HealthGrade,
  ProviderType,
} from './types.js';
import { computeProgressPercent } from './quota.js';

export function computeMonthlyEquivalent(amount: number, billingCycle: BillingCycle): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return billingCycle === 'yearly' ? amount / 12 : amount;
}

/**
 * Compute days remaining until next billing date (0 = today).
 * Supports both monthly (day 1-31, clamped to month length) and yearly (month 1-12, day 1-31).
 */
export function computeDaysUntilNextBilling(
  billingCycle: BillingCycle,
  billingDay: number | null,
  billingMonth: number | null,
  nowDate: Date = new Date(),
): number | null {
  if (!billingDay || billingDay < 1 || billingDay > 31) return null;

  const today = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate());
  const todayMs = today.getTime();

  if (billingCycle === 'monthly') {
    const daysInThisMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    let candidate = new Date(
      today.getFullYear(),
      today.getMonth(),
      Math.min(billingDay, daysInThisMonth),
    );
    if (candidate.getTime() < todayMs) {
      const nextMonth = today.getMonth() + 1;
      const daysInNextMonth = new Date(today.getFullYear(), nextMonth + 1, 0).getDate();
      candidate = new Date(
        today.getFullYear(),
        nextMonth,
        Math.min(billingDay, daysInNextMonth),
      );
    }
    return Math.round((candidate.getTime() - todayMs) / 86_400_000);
  }

  // Yearly billing cycle
  if (!billingMonth || billingMonth < 1 || billingMonth > 12) return null;
  const monthIdx = billingMonth - 1;
  const daysInTargetMonth = new Date(today.getFullYear(), monthIdx + 1, 0).getDate();
  let candidate = new Date(
    today.getFullYear(),
    monthIdx,
    Math.min(billingDay, daysInTargetMonth),
  );
  if (candidate.getTime() < todayMs) {
    const nextYear = today.getFullYear() + 1;
    const daysNext = new Date(nextYear, monthIdx + 1, 0).getDate();
    candidate = new Date(nextYear, monthIdx, Math.min(billingDay, daysNext));
  }
  return Math.round((candidate.getTime() - todayMs) / 86_400_000);
}

/**
 * Evaluate subscription health & unsubscribe suggestion for a provider plan.
 */
export function evaluateSubscriptionHealth(params: {
  provider: ProviderType;
  isPaused: boolean;
  activeDays: number;
  periodDays: number;
  totalInteractions: number;
  daysSinceLastActive: number | null;
  avgWeeklyUtilization: number | null;
  monthlyEquivalentCost: number;
  daysUntilNextBilling: number | null;
  idleDaysThreshold: number;
}): { grade: HealthGrade; headline: string; suggestion: string } {
  if (params.isPaused) {
    return {
      grade: 'paused',
      headline: '已停訂／暫停追蹤',
      suggestion: '已保留歷史用量紀錄，不再發送低用量提醒。',
    };
  }

  const hasActivity = params.activeDays > 0 || params.totalInteractions > 0;
  const idleTooLong =
    params.daysSinceLastActive !== null && params.daysSinceLastActive >= params.idleDaysThreshold;

  // Claude uses percentage snapshots as primary activity signal when available
  const isClaude = params.provider === 'claude';
  const lowClaudeUtil =
    isClaude && params.avgWeeklyUtilization !== null && params.avgWeeklyUtilization < 15;

  if (!hasActivity) {
    if (params.monthlyEquivalentCost > 0) {
      return {
        grade: 'cancel_candidate',
        headline: '本期間零使用',
        suggestion:
          params.daysUntilNextBilling !== null
            ? `距離下次扣款剩 ${params.daysUntilNextBilling} 天，建議評估暫停續訂。`
            : '這段期間完全沒有使用紀錄，建議檢討是否繼續付費。',
      };
    }
    return {
      grade: 'no_data',
      headline: '尚無用量紀錄',
      suggestion: '開始使用後系統將自動累積活躍度與 CP 值評估。',
    };
  }

  if (idleTooLong || (params.activeDays <= 2 && params.periodDays >= 20 && (lowClaudeUtil || params.totalInteractions < 8))) {
    return {
      grade: 'cancel_candidate',
      headline: idleTooLong
        ? `已閒置 ${params.daysSinceLastActive} 天`
        : `活躍偏低（${params.activeDays} 天）`,
      suggestion:
        params.daysUntilNextBilling !== null
          ? `距離下次扣款僅剩 ${params.daysUntilNextBilling} 天，可考慮先停訂省荷包。`
          : '近期使用率明顯偏低，建議檢討是否暫停續訂或降級方案。',
    };
  }

  if (
    params.activeDays <= 5 ||
    (isClaude && params.avgWeeklyUtilization !== null && params.avgWeeklyUtilization < 30)
  ) {
    return {
      grade: 'low',
      headline: `偏低使用（活躍 ${params.activeDays} 天）`,
      suggestion: '使用頻率不高，可觀察下期用量再決定是否續訂。',
    };
  }

  return {
    grade: 'great',
    headline: isClaude && params.avgWeeklyUtilization !== null
      ? `主力愛將 · 週均消耗 ${Math.round(params.avgWeeklyUtilization)}%`
      : `主力愛將 · 活躍 ${params.activeDays} 天`,
    suggestion: '使用頻率穩定，訂閱利用率良好！',
  };
}

/**
 * Determine whether current hour (0-23) falls within configured quiet hours.
 * Handles overnight spans like 23 -> 8 cleanly.
 */
export function isWithinQuietHours(
  currentHour: number,
  startHour: number,
  endHour: number,
): boolean {
  if (startHour === endHour) return false;
  if (startHour < endHour) {
    return currentHour >= startHour && currentHour < endHour;
  }
  return currentHour >= startHour || currentHour < endHour;
}

/**
 * Score an account by currently available quota (higher = more available headroom).
 * Used for Smart Sort so fresh/full accounts float to the top.
 */
export function computeAccountAvailabilityScore(account: AccountDTO): number {
  if (account.buckets.length === 0) return 50;
  let totalHeadroom = 0;
  for (const b of account.buckets) {
    if (b.status === 'exhausted') {
      totalHeadroom += 0;
    } else {
      const usedPct = computeProgressPercent(b.measureMode, b.usedValue, b.limitValue, b.status);
      totalHeadroom += Math.max(0, 100 - usedPct);
    }
  }
  return totalHeadroom / account.buckets.length;
}
