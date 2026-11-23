import type { MeasureMode, QuotaStatus } from './types.js';

export function computeBucketStatus(
  measureMode: MeasureMode,
  usedValue: number,
  limitValue: number | null,
  resetAt: string | null,
  explicitStatus?: QuotaStatus,
  nowMs: number = Date.now(),
): QuotaStatus {
  // If a cooldown/exhausted resetAt has already passed, recover to ok automatically
  const resetPassed = resetAt ? Date.parse(resetAt) <= nowMs : false;

  if (explicitStatus === 'exhausted') {
    return resetPassed ? 'ok' : 'exhausted';
  }

  if (measureMode === 'cooldown') {
    if (resetAt && !resetPassed) return 'exhausted';
    return explicitStatus === 'warning' ? 'warning' : 'ok';
  }

  if (measureMode === 'percent') {
    if (usedValue >= 95) return resetPassed ? 'ok' : 'exhausted';
    if (usedValue >= 75) return 'warning';
    return explicitStatus ?? 'ok';
  }

  // count mode
  if (limitValue && limitValue > 0) {
    const ratio = usedValue / limitValue;
    if (ratio >= 1) return resetPassed ? 'ok' : 'exhausted';
    if (ratio >= 0.78) return 'warning';
  }

  return explicitStatus ?? 'ok';
}

export function computeProgressPercent(
  measureMode: MeasureMode,
  usedValue: number,
  limitValue: number | null,
  status: QuotaStatus,
): number {
  if (status === 'exhausted' && measureMode !== 'percent') {
    return 100;
  }
  if (measureMode === 'percent') {
    return Math.max(0, Math.min(100, Math.round(usedValue)));
  }
  if (measureMode === 'count' && limitValue && limitValue > 0) {
    return Math.max(0, Math.min(100, Math.round((usedValue / limitValue) * 100)));
  }
  if (measureMode === 'count') {
    // Soft visual indicator when limit is unknown
    return Math.max(0, Math.min(100, Math.round(usedValue * 2)));
  }
  return status === 'exhausted' ? 100 : status === 'warning' ? 80 : 0;
}

export function formatCountdown(
  resetAtIso: string | null | undefined,
  nowMs: number = Date.now(),
): string | null {
  if (!resetAtIso) return null;
  const targetMs = Date.parse(resetAtIso);
  if (Number.isNaN(targetMs)) return null;

  const diffMs = targetMs - nowMs;
  if (diffMs <= 0) return '已重置';

  const totalMinutes = Math.ceil(diffMs / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h 後重置` : `${days}d 後重置`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m 後重置` : `${hours}h 後重置`;
  }
  if (diffMs < 60_000) {
    const seconds = Math.max(1, Math.ceil(diffMs / 1000));
    return `${seconds}s 後重置`;
  }
  return `${minutes}m 後重置`;
}
