import React from 'react';
import { Flame, Plus, RotateCcw } from 'lucide-react';
import {
  computeProgressPercent,
  formatCountdown,
  type BucketType,
  type ManualAdjustInput,
  type QuotaBucketDTO,
} from '@ai-quota/shared';

interface QuotaBarProps {
  bucket: QuotaBucketDTO;
  nowMs: number;
  onManualAdjust?: (input: ManualAdjustInput) => void;
}

const ADJUSTABLE_BUCKETS = new Set<BucketType>([
  'gemini_web',
  'chatgpt_reasoning',
  'chatgpt_general',
  'chatgpt_deep_research',
  'chatgpt_image',
]);

export const QuotaBar: React.FC<QuotaBarProps> = ({ bucket, nowMs, onManualAdjust }) => {
  const percent = computeProgressPercent(
    bucket.measureMode,
    bucket.usedValue,
    bucket.limitValue,
    bucket.status,
  );
  const countdown = formatCountdown(bucket.resetAt, nowMs);

  const barGradient =
    bucket.status === 'exhausted'
      ? 'from-rose-500 to-red-400'
      : bucket.status === 'warning'
        ? 'from-amber-400 to-orange-400'
        : 'from-emerald-400 via-sky-400 to-indigo-400';

  const statusPill = getStatusPill(bucket);
  const valueText = formatBucketValue(bucket);
  const canAdjust = Boolean(onManualAdjust) && ADJUSTABLE_BUCKETS.has(bucket.bucketType);

  return (
    <div className="group/bar space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-[0.82rem]">
        <span className="text-slate-300 font-medium truncate">{bucket.label}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          {canAdjust && (
            <div className="flex items-center gap-1 opacity-0 group-hover/bar:opacity-100 transition-opacity">
              <button
                type="button"
                title="手機使用後快速補記 +1 次"
                onClick={() =>
                  onManualAdjust?.({
                    accountId: bucket.accountId,
                    bucketType: bucket.bucketType,
                    action: 'increment',
                  })
                }
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-white/10 hover:bg-sky-500/30 text-[0.68rem] text-sky-200 cursor-pointer"
              >
                <Plus className="w-2.5 h-2.5" />1
              </button>
              {bucket.status === 'exhausted' ? (
                <button
                  type="button"
                  title="手動解除冷卻狀態"
                  onClick={() =>
                    onManualAdjust?.({
                      accountId: bucket.accountId,
                      bucketType: bucket.bucketType,
                      action: 'reset_status',
                    })
                  }
                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-white/10 hover:bg-emerald-500/30 text-[0.68rem] text-emerald-200 cursor-pointer"
                >
                  <RotateCcw className="w-2.5 h-2.5" />
                  復原
                </button>
              ) : (
                <button
                  type="button"
                  title="標記已觸頂／冷卻中（預設 3 小時）"
                  onClick={() =>
                    onManualAdjust?.({
                      accountId: bucket.accountId,
                      bucketType: bucket.bucketType,
                      action: 'mark_exhausted',
                      cooldownMinutes: 180,
                    })
                  }
                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-white/10 hover:bg-rose-500/30 text-[0.68rem] text-rose-200 cursor-pointer"
                >
                  <Flame className="w-2.5 h-2.5" />
                  觸頂
                </button>
              )}
            </div>
          )}

          <span className="text-slate-100 tabular-nums font-semibold">{valueText}</span>
          <span
            className={`px-1.5 py-0.5 rounded-full text-[0.72rem] font-medium leading-none ${statusPill.className}`}
          >
            {statusPill.text}
          </span>
        </div>
      </div>

      <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${barGradient} transition-all duration-500`}
          style={{ width: `${Math.max(percent, bucket.usedValue > 0 ? 4 : 0)}%` }}
        />
      </div>

      {(countdown || (bucket.tokensToday && bucket.tokensToday > 0)) && (
        <div className="flex items-center justify-between text-[0.74rem] text-slate-400">
          <span>
            {bucket.tokensToday && bucket.tokensToday > 0
              ? `今日 ${formatCompactTokens(bucket.tokensToday)} tokens`
              : ''}
          </span>
          {countdown && <span className="text-sky-300/90 tabular-nums">⏳ {countdown}</span>}
        </div>
      )}
    </div>
  );
};

function formatBucketValue(bucket: QuotaBucketDTO): string {
  if (bucket.measureMode === 'percent') {
    return `${Math.round(bucket.usedValue)}%`;
  }
  if (bucket.measureMode === 'count') {
    if (bucket.bucketType === 'gemini_web') {
      return `今日 ${Math.round(bucket.usedValue)} 次`;
    }
    if (bucket.limitValue && bucket.limitValue > 0) {
      return `${Math.round(bucket.usedValue)} / ${Math.round(bucket.limitValue)}`;
    }
    return `${Math.round(bucket.usedValue)} 次`;
  }
  return bucket.status === 'exhausted' ? '冷卻中' : '可用';
}

function getStatusPill(bucket: QuotaBucketDTO): { text: string; className: string } {
  if (bucket.status === 'exhausted') {
    return {
      text: '冷卻中',
      className: 'bg-rose-500/20 text-rose-300 border border-rose-400/25',
    };
  }
  if (bucket.status === 'warning') {
    return {
      text: '快觸頂',
      className: 'bg-amber-500/20 text-amber-200 border border-amber-400/25',
    };
  }
  if (bucket.usedValue === 0) {
    return {
      text: '✨ 滿血',
      className: 'bg-sky-500/20 text-sky-200 border border-sky-400/25',
    };
  }
  return {
    text: '充裕',
    className: 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/25',
  };
}

function formatCompactTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
}
