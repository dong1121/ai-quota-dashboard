import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  BarChart3,
  Calendar,
  Clock,
  Coins,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Settings2,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
  Type,
  Users,
  X,
} from 'lucide-react';
import {
  MAX_ANALYTICS_OPACITY,
  MAX_FONT_SCALE,
  MIN_ANALYTICS_OPACITY,
  MIN_FONT_SCALE,
  PROVIDER_META,
  type AnalyticsRange,
  type AnalyticsReportDTO,
  type AppConfig,
  type BillingCycle,
  type HealthGrade,
  type ProviderHealthDTO,
  type ProviderType,
  type SubscriptionCostDTO,
} from '@ai-quota/shared';

const FONT_PRESETS = [
  { label: '精巧', scale: 90 },
  { label: '標準', scale: 100 },
  { label: '大字', scale: 115 },
  { label: '特大', scale: 130 },
] as const;

const OPACITY_PRESETS = [
  { label: '透亮', value: 84 },
  { label: '清晰', value: 94 },
  { label: '實色', value: 100 },
] as const;

const RANGES: Array<{ id: AnalyticsRange; label: string }> = [
  { id: '7d', label: '近 7 天' },
  { id: 'this_month', label: '本月' },
  { id: 'last_month', label: '上個月' },
  { id: '90d', label: '近 90 天' },
];

export const AnalyticsWindow: React.FC = () => {
  const [range, setRange] = useState<AnalyticsRange>('this_month');
  const [report, setReport] = useState<AnalyticsReportDTO | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingProvider, setEditingProvider] = useState<ProviderType | null>(null);
  const [hoveredDay, setHoveredDay] = useState<number | null>(null);
  const [showAppearance, setShowAppearance] = useState(false);

  const loadReport = useCallback(async (targetRange: AnalyticsRange) => {
    setLoading(true);
    try {
      const data = await window.quotaApi.getAnalytics(targetRange);
      setReport(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void window.quotaApi.getConfig().then(setConfig);
    const offCfg = window.quotaApi.onConfigUpdated(setConfig);
    const offDash = window.quotaApi.onDashboardUpdated(() => {
      void loadReport(range);
    });
    return () => {
      offCfg();
      offDash();
    };
  }, [loadReport, range]);

  useEffect(() => {
    const scale = config?.analyticsFontScale ?? config?.fontScale ?? 100;
    document.documentElement.style.fontSize = `${scale}%`;
  }, [config?.analyticsFontScale, config?.fontScale]);

  const handleUpdateAppearance = async (patch: Partial<AppConfig>) => {
    if (patch.analyticsFontScale !== undefined) {
      document.documentElement.style.fontSize = `${patch.analyticsFontScale}%`;
    }
    const res = await window.quotaApi.updateConfig(patch);
    setConfig(res.config);
  };

  useEffect(() => {
    void loadReport(range);
  }, [loadReport, range]);

  const handleSaveSubscription = async (sub: SubscriptionCostDTO) => {
    await window.quotaApi.upsertSubscriptionCost(sub);
    setEditingProvider(null);
    await loadReport(range);
  };

  const handleSnooze = async (provider: ProviderType) => {
    await window.quotaApi.snoozeSubscription(provider, 30);
    await loadReport(range);
  };

  const maxDailyTotal = Math.max(
    1,
    ...(report?.dailySeries.map((d) => d.total) ?? [1]),
  );
  const maxHourly = Math.max(
    1,
    ...(report?.hourlyDistribution.map((h) => h.count) ?? [1]),
  );

  const avgCostOverall =
    report && report.totalMonthlyCost > 0 && report.totalInteractions > 0
      ? Math.round((report.totalMonthlyCost / report.totalInteractions) * 10) / 10
      : null;

  const analyticsFontScale = config?.analyticsFontScale ?? 100;
  const analyticsOpacity = config?.analyticsOpacity ?? 96;
  const shellStyle = {
    '--shell-alpha': analyticsOpacity / 100,
  } as React.CSSProperties;

  return (
    <div className="h-full w-full p-2">
      <div
        className="glass-shell-analytics relative h-full w-full rounded-2xl flex flex-col overflow-hidden"
        style={shellStyle}
      >
        {/* Draggable Wide Title Bar */}
        <header className="app-drag flex items-center justify-between px-5 py-3 border-b border-white/10 select-none">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-500 flex items-center justify-center shadow-md shadow-sky-500/25">
              <BarChart3 className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-[1rem] font-semibold text-slate-100 leading-tight">
                AI 用量統計與訂閱 CP 值體檢
              </h1>
              <p className="text-[0.74rem] text-slate-400">
                {report ? `${report.periodLabel} · 方案層級計費＋多帳號負載分析` : '載入資料中…'}
              </p>
            </div>
          </div>

          <div className="app-no-drag flex items-center gap-2">
            <div className="flex items-center p-0.5 rounded-lg bg-black/35 border border-white/10">
              {RANGES.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setRange(r.id)}
                  className={`px-2.5 py-1 rounded-md text-[0.76rem] font-medium transition-colors cursor-pointer ${
                    range === r.id
                      ? 'bg-indigo-500/40 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setShowAppearance((v) => !v)}
              title="調整統計頁字體大小與背景不透明度"
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[0.76rem] border transition-colors cursor-pointer ${
                showAppearance
                  ? 'bg-sky-500/30 border-sky-400/50 text-white'
                  : 'bg-white/6 border-white/12 text-slate-200 hover:bg-white/12'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>外觀</span>
            </button>

            <button
              type="button"
              onClick={() => void loadReport(range)}
              title="重新整理統計"
              className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-sky-300' : ''}`} />
            </button>

            <button
              type="button"
              onClick={() => void window.quotaApi.closeCurrentWindow()}
              title="關閉統計視窗"
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-rose-500/30 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Floating Appearance Popover (Font Size + Background Opacity) */}
        {showAppearance && (
          <div className="absolute top-14 right-5 z-30 w-72 rounded-xl bg-slate-950/95 border border-white/18 shadow-2xl p-3.5 space-y-3 text-[0.8rem]">
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <span className="inline-flex items-center gap-1.5 font-semibold text-slate-100">
                <Type className="w-4 h-4 text-sky-300" />
                統計頁外觀調整
              </span>
              <button
                type="button"
                onClick={() => setShowAppearance(false)}
                className="p-0.5 rounded hover:bg-white/10 text-slate-400 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Analytics Font Scale */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[0.76rem]">
                <span className="text-slate-300">字體大小</span>
                <span className="font-mono text-sky-300">{analyticsFontScale}%</span>
              </div>
              <div className="grid grid-cols-4 gap-1">
                {FONT_PRESETS.map((p) => (
                  <button
                    key={p.scale}
                    type="button"
                    onClick={() => void handleUpdateAppearance({ analyticsFontScale: p.scale })}
                    className={`py-1 rounded-md text-[0.72rem] border cursor-pointer ${
                      analyticsFontScale === p.scale
                        ? 'bg-sky-500/35 border-sky-400/50 text-white'
                        : 'bg-white/6 border-white/10 text-slate-300 hover:bg-white/12'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <input
                type="range"
                min={MIN_FONT_SCALE}
                max={MAX_FONT_SCALE}
                step={5}
                value={analyticsFontScale}
                onChange={(e) =>
                  void handleUpdateAppearance({ analyticsFontScale: Number(e.target.value) })
                }
                className="w-full accent-sky-400 cursor-pointer"
              />
            </div>

            {/* Analytics Opacity */}
            <div className="space-y-1.5 pt-2 border-t border-white/10">
              <div className="flex items-center justify-between text-[0.76rem]">
                <span className="text-slate-300">背景不透明度（濃淡）</span>
                <span className="font-mono text-indigo-300">{analyticsOpacity}%</span>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {OPACITY_PRESETS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => void handleUpdateAppearance({ analyticsOpacity: p.value })}
                    className={`py-1 rounded-md text-[0.72rem] border cursor-pointer ${
                      analyticsOpacity === p.value
                        ? 'bg-indigo-500/35 border-indigo-400/50 text-white'
                        : 'bg-white/6 border-white/10 text-slate-300 hover:bg-white/12'
                    }`}
                  >
                    {p.label} ({p.value}%)
                  </button>
                ))}
              </div>
              <input
                type="range"
                min={MIN_ANALYTICS_OPACITY}
                max={MAX_ANALYTICS_OPACITY}
                step={2}
                value={analyticsOpacity}
                onChange={(e) =>
                  void handleUpdateAppearance({ analyticsOpacity: Number(e.target.value) })
                }
                className="w-full accent-indigo-400 cursor-pointer"
              />
            </div>
          </div>
        )}

        {/* Main Scrollable Report */}
        <main className="flex-1 overflow-y-auto custom-scroll p-5 space-y-5">
          {report && (
            <>
              {/* Row 1: 4 KPI Cards */}
              <section className="grid grid-cols-4 gap-3">
                <KpiCard
                  icon={<Activity className="w-4 h-4 text-sky-300" />}
                  label="期間總互動次數"
                  value={report.totalInteractions.toLocaleString()}
                  sub={
                    report.deltaPercent !== null ? (
                      <span
                        className={`inline-flex items-center gap-0.5 ${
                          report.deltaPercent >= 0 ? 'text-emerald-300' : 'text-amber-300'
                        }`}
                      >
                        {report.deltaPercent >= 0 ? (
                          <TrendingUp className="w-3 h-3" />
                        ) : (
                          <TrendingDown className="w-3 h-3" />
                        )}
                        較前期 {report.deltaPercent >= 0 ? '+' : ''}
                        {report.deltaPercent}%
                      </span>
                    ) : (
                      '持續累積趨勢中'
                    )
                  }
                />

                <KpiCard
                  icon={<Coins className="w-4 h-4 text-amber-300" />}
                  label="折算每月總訂閱費"
                  value={
                    report.totalMonthlyCost > 0
                      ? `NT$ ${report.totalMonthlyCost.toLocaleString()}`
                      : '未設定'
                  }
                  sub="含月繳＋年繳均攤月費"
                />

                <KpiCard
                  icon={<Calendar className="w-4 h-4 text-emerald-300" />}
                  label="總活躍天數"
                  value={`${report.totalActiveDays} / ${report.periodDays} 天`}
                  sub={`活躍率 ${Math.round((report.totalActiveDays / Math.max(1, report.periodDays)) * 100)}%`}
                />

                <KpiCard
                  icon={<Clock className="w-4 h-4 text-indigo-300" />}
                  label="平均單次成本"
                  value={avgCostOverall !== null ? `NT$ ${avgCostOverall}` : '—'}
                  sub={avgCostOverall !== null ? '越低代表訂閱越划算' : '填寫費用後自動試算'}
                />
              </section>

              {/* Row 2: Subscription Health & Unsubscribe Diagnosis */}
              <section className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-[0.92rem] font-semibold text-slate-100">
                      訂閱方案 CP 值體檢（低用量／停訂評估）
                    </h2>
                    <p className="text-[0.74rem] text-slate-400">
                      以「整份付費方案」為單位彙總底下所有帳號（例如 Gemini 家庭版只計一份月費／年費，不會重複計費）
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  {report.providerHealth.map((item) => (
                    <ProviderHealthCard
                      key={item.provider}
                      item={item}
                      isEditing={editingProvider === item.provider}
                      onStartEdit={() =>
                        setEditingProvider(editingProvider === item.provider ? null : item.provider)
                      }
                      onSaveSubscription={(sub) => void handleSaveSubscription(sub)}
                      onSnooze={() => void handleSnooze(item.provider)}
                    />
                  ))}
                </div>
              </section>

              {/* Row 3: Daily Trend Chart + Multi-Account Load Breakdown */}
              <section className="grid grid-cols-12 gap-3.5">
                {/* Daily Stacked Trend */}
                <div className="col-span-7 glass-card rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <h3 className="text-[0.88rem] font-semibold text-slate-100">
                      每日使用趨勢
                    </h3>
                    <div className="flex items-center gap-2.5 text-[0.7rem] text-slate-300">
                      <LegendDot color="#a78bfa" label="Claude" />
                      <LegendDot color="#3b82f6" label="Gemini 網頁" />
                      <LegendDot color="#38bdf8" label="Gemini CLI" />
                      <LegendDot color="#818cf8" label="AGY CLI" />
                      <LegendDot color="#10b981" label="ChatGPT" />
                    </div>
                  </div>

                  <div className="relative h-44 flex items-end gap-[3px] pt-6 pb-5 px-1 border-b border-white/8">
                    {report.dailySeries.map((day, idx) => {
                      const heightPct = (day.total / maxDailyTotal) * 100;
                      const showLabel =
                        report.dailySeries.length <= 14 ||
                        idx === 0 ||
                        idx === report.dailySeries.length - 1 ||
                        idx % Math.ceil(report.dailySeries.length / 7) === 0;

                      return (
                        <div
                          key={day.date}
                          onMouseEnter={() => setHoveredDay(idx)}
                          onMouseLeave={() => setHoveredDay(null)}
                          className="relative flex-1 h-full flex flex-col justify-end items-center group"
                        >
                          <div
                            className="w-full max-w-[20px] rounded-t-sm overflow-hidden flex flex-col-reverse bg-white/5 transition-all group-hover:brightness-125"
                            style={{ height: `${Math.max(heightPct, day.total > 0 ? 5 : 2)}%` }}
                          >
                            {day.claude > 0 && (
                              <div
                                style={{
                                  height: `${(day.claude / day.total) * 100}%`,
                                  backgroundColor: '#a78bfa',
                                }}
                              />
                            )}
                            {day.geminiWeb > 0 && (
                              <div
                                style={{
                                  height: `${(day.geminiWeb / day.total) * 100}%`,
                                  backgroundColor: '#3b82f6',
                                }}
                              />
                            )}
                            {day.geminiCli > 0 && (
                              <div
                                style={{
                                  height: `${(day.geminiCli / day.total) * 100}%`,
                                  backgroundColor: '#38bdf8',
                                }}
                              />
                            )}
                            {day.antigravityCli > 0 && (
                              <div
                                style={{
                                  height: `${(day.antigravityCli / day.total) * 100}%`,
                                  backgroundColor: '#818cf8',
                                }}
                              />
                            )}
                            {day.chatgpt > 0 && (
                              <div
                                style={{
                                  height: `${(day.chatgpt / day.total) * 100}%`,
                                  backgroundColor: '#10b981',
                                }}
                              />
                            )}
                          </div>

                          {showLabel && (
                            <span className="absolute -bottom-5 text-[0.65rem] text-slate-400 font-mono whitespace-nowrap">
                              {day.date.slice(5)}
                            </span>
                          )}
                        </div>
                      );
                    })}

                    {/* Hover Summary Pill */}
                    {hoveredDay !== null && report.dailySeries[hoveredDay] && (
                      <div className="absolute top-0 right-1 px-2.5 py-1 rounded-lg bg-slate-900/95 border border-white/15 text-[0.72rem] text-slate-200 shadow-lg pointer-events-none">
                        <span className="font-mono text-sky-300 mr-2">
                          {report.dailySeries[hoveredDay]!.date}
                        </span>
                        <span>共 {report.dailySeries[hoveredDay]!.total} 次</span>
                        <span className="text-slate-400 ml-2">
                          (G網 {report.dailySeries[hoveredDay]!.geminiWeb} / CLI{' '}
                          {report.dailySeries[hoveredDay]!.geminiCli} / AGY{' '}
                          {report.dailySeries[hoveredDay]!.antigravityCli} / GPT{' '}
                          {report.dailySeries[hoveredDay]!.chatgpt} / Claude{' '}
                          {report.dailySeries[hoveredDay]!.claude})
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Multi-Account / Family Group Load Distribution */}
                <div className="col-span-5 glass-card rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Users className="w-4 h-4 text-sky-300" />
                      <h3 className="text-[0.88rem] font-semibold text-slate-100">
                        多帳號／家庭群組負載分佈
                      </h3>
                    </div>
                    <span className="text-[0.7rem] text-slate-400">同服務內佔比</span>
                  </div>

                  {report.accountBreakdown.length === 0 ? (
                    <p className="text-[0.8rem] text-slate-400 py-8 text-center">
                      尚無追蹤中的帳號紀錄
                    </p>
                  ) : (
                    <div className="space-y-2.5 max-h-48 overflow-y-auto custom-scroll pr-1">
                      {report.accountBreakdown.map((acc) => (
                        <div key={acc.accountId} className="space-y-1">
                          <div className="flex items-center justify-between gap-2 text-[0.78rem]">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: acc.colorTag }}
                              />
                              <span className="text-slate-200 font-medium truncate">
                                {acc.displayName}
                              </span>
                              <span className="text-[0.68rem] text-slate-400 shrink-0">
                                {PROVIDER_META[acc.provider].badgeText}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0 text-[0.72rem] tabular-nums">
                              {acc.daysSinceLastActive !== null && acc.daysSinceLastActive >= 7 && (
                                <span className="px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-300 text-[0.66rem]">
                                  💤 {acc.daysSinceLastActive}天未用
                                </span>
                              )}
                              <span className="text-slate-100 font-semibold">
                                {acc.interactions} 次
                              </span>
                              <span className="text-slate-400 w-8 text-right">
                                {acc.sharePercent}%
                              </span>
                            </div>
                          </div>
                          <div className="h-1.5 rounded-full bg-white/8 overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${Math.max(acc.sharePercent, acc.interactions > 0 ? 4 : 0)}%`,
                                backgroundColor: acc.colorTag,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>

              {/* Row 4: 24-Hour Peak Usage Distribution */}
              <section className="glass-card rounded-xl p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-[0.86rem] font-semibold text-slate-100">
                    24 小時使用高峰分佈（輔助調整夜間勿擾時段）
                  </h3>
                  <span className="text-[0.72rem] text-slate-400">本地時間 00:00 – 23:00</span>
                </div>
                <div className="h-20 flex items-end gap-1 pt-2 pb-4">
                  {report.hourlyDistribution.map((h) => {
                    const pct = (h.count / maxHourly) * 100;
                    return (
                      <div
                        key={h.hour}
                        title={`${String(h.hour).padStart(2, '0')}:00 — ${h.count} 次`}
                        className="relative flex-1 h-full flex flex-col justify-end items-center"
                      >
                        <div
                          className="w-full rounded-t bg-gradient-to-t from-indigo-500/70 to-sky-400/90 transition-all"
                          style={{ height: `${Math.max(pct, h.count > 0 ? 8 : 3)}%` }}
                        />
                        {h.hour % 3 === 0 && (
                          <span className="absolute -bottom-4 text-[0.64rem] text-slate-500 font-mono">
                            {String(h.hour).padStart(2, '0')}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
};

const KpiCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: React.ReactNode;
}> = ({ icon, label, value, sub }) => (
  <div className="glass-card rounded-xl p-3.5 space-y-1.5">
    <div className="flex items-center justify-between text-[0.76rem] text-slate-400">
      <span>{label}</span>
      {icon}
    </div>
    <div className="text-[1.25rem] font-bold text-slate-100 tabular-nums leading-tight">
      {value}
    </div>
    <div className="text-[0.72rem] text-slate-400">{sub}</div>
  </div>
);

const LegendDot: React.FC<{ color: string; label: string }> = ({ color, label }) => (
  <span className="inline-flex items-center gap-1">
    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
    <span>{label}</span>
  </span>
);

const GRADE_STYLE: Record<HealthGrade, { label: string; badge: string }> = {
  great: {
    label: '🟢 超值主力',
    badge: 'bg-emerald-500/20 text-emerald-200 border-emerald-400/30',
  },
  low: {
    label: '🟡 偏低使用',
    badge: 'bg-amber-500/20 text-amber-200 border-amber-400/30',
  },
  cancel_candidate: {
    label: '🔴 建議檢討停訂',
    badge: 'bg-rose-500/20 text-rose-200 border-rose-400/35',
  },
  paused: {
    label: '⏸️ 已停訂封存',
    badge: 'bg-slate-600/30 text-slate-300 border-slate-500/30',
  },
  no_data: {
    label: '⚪ 尚無紀錄',
    badge: 'bg-white/10 text-slate-300 border-white/15',
  },
};

const ProviderHealthCard: React.FC<{
  item: ProviderHealthDTO;
  isEditing: boolean;
  onStartEdit: () => void;
  onSaveSubscription: (sub: SubscriptionCostDTO) => void;
  onSnooze: () => void;
}> = ({ item, isEditing, onStartEdit, onSaveSubscription, onSnooze }) => {
  const meta = PROVIDER_META[item.provider];
  const style = GRADE_STYLE[item.grade];
  const sub = item.subscription;

  const [cycle, setCycle] = useState<BillingCycle>(sub.billingCycle);
  const [amount, setAmount] = useState(String(sub.amount || ''));
  const [billingMonth, setBillingMonth] = useState(String(sub.billingMonth ?? 1));
  const [billingDay, setBillingDay] = useState(String(sub.billingDay ?? ''));

  useEffect(() => {
    setCycle(sub.billingCycle);
    setAmount(String(sub.amount || ''));
    setBillingMonth(String(sub.billingMonth ?? 1));
    setBillingDay(String(sub.billingDay ?? ''));
  }, [sub]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveSubscription({
      ...sub,
      billingCycle: cycle,
      amount: Math.max(0, Number(amount) || 0),
      billingDay: billingDay ? Math.max(1, Math.min(31, Number(billingDay))) : null,
      billingMonth:
        cycle === 'yearly' ? Math.max(1, Math.min(12, Number(billingMonth) || 1)) : null,
    });
  };

  return (
    <div className="glass-card rounded-xl p-3.5 flex flex-col justify-between space-y-2.5">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: meta.defaultColor }}
            />
            <span className="font-semibold text-[0.9rem] text-slate-100">{meta.name}</span>
            {item.accountCount > 1 && (
              <span className="text-[0.68rem] px-1.5 py-0.5 rounded bg-white/8 text-slate-300">
                {item.accountCount} 帳號合計
              </span>
            )}
          </div>
          <span className={`px-2 py-0.5 rounded-full text-[0.7rem] font-medium border ${style.badge}`}>
            {style.label}
          </span>
        </div>

        {/* Metrics Summary */}
        <div className="grid grid-cols-2 gap-1.5 text-[0.76rem] bg-black/25 rounded-lg p-2 border border-white/6">
          <div>
            <span className="text-slate-400 block text-[0.68rem]">方案費用</span>
            <span className="text-slate-100 font-semibold">
              {sub.amount > 0
                ? sub.billingCycle === 'yearly'
                  ? `年繳 ${sub.amount.toLocaleString()} (均 ${item.monthlyEquivalentCost}/月)`
                  : `月繳 ${sub.amount.toLocaleString()}`
                : '未填費用'}
            </span>
          </div>
          <div>
            <span className="text-slate-400 block text-[0.68rem]">下次扣款</span>
            <span className="text-sky-300 font-semibold">
              {item.daysUntilNextBilling !== null ? `${item.daysUntilNextBilling} 天後` : '未設扣款日'}
            </span>
          </div>
          <div>
            <span className="text-slate-400 block text-[0.68rem]">活躍 / 互動</span>
            <span className="text-slate-200">
              {item.activeDays} 天 ·{' '}
              {item.provider === 'claude' && item.avgWeeklyUtilization !== null
                ? `週均 ${item.avgWeeklyUtilization}%`
                : `${item.totalInteractions} 次`}
            </span>
          </div>
          <div>
            <span className="text-slate-400 block text-[0.68rem]">平均單次成本</span>
            <span className="text-slate-200">
              {item.costPerInteraction !== null ? `NT$ ${item.costPerInteraction}` : '—'}
            </span>
          </div>
        </div>

        <p className="text-[0.74rem] text-slate-300 leading-relaxed">
          <strong className="text-slate-100">{item.headline}</strong> — {item.suggestion}
        </p>

        {/* Inline Monthly / Yearly Billing Form */}
        {isEditing && (
          <form
            onSubmit={handleSubmit}
            className="rounded-lg bg-black/45 border border-white/15 p-2.5 space-y-2 text-[0.74rem]"
          >
            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={() => setCycle('monthly')}
                className={`py-1 rounded border font-medium cursor-pointer ${
                  cycle === 'monthly'
                    ? 'bg-sky-500/35 border-sky-400/50 text-white'
                    : 'bg-white/5 border-white/10 text-slate-400'
                }`}
              >
                月繳方案
              </button>
              <button
                type="button"
                onClick={() => setCycle('yearly')}
                className={`py-1 rounded border font-medium cursor-pointer ${
                  cycle === 'yearly'
                    ? 'bg-sky-500/35 border-sky-400/50 text-white'
                    : 'bg-white/5 border-white/10 text-slate-400'
                }`}
              >
                年繳方案
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <label className="space-y-0.5 text-slate-400">
                <span>{cycle === 'yearly' ? '年繳金額 (TWD)' : '月費金額 (TWD)'}</span>
                <input
                  type="number"
                  min={0}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={cycle === 'yearly' ? '例如 6500' : '例如 660'}
                  className="w-full px-2 py-1 rounded bg-white/8 border border-white/15 text-slate-100 font-mono"
                />
              </label>

              {cycle === 'yearly' ? (
                <div className="grid grid-cols-2 gap-1">
                  <label className="space-y-0.5 text-slate-400">
                    <span>續約月</span>
                    <input
                      type="number"
                      min={1}
                      max={12}
                      value={billingMonth}
                      onChange={(e) => setBillingMonth(e.target.value)}
                      className="w-full px-1.5 py-1 rounded bg-white/8 border border-white/15 text-slate-100 font-mono"
                    />
                  </label>
                  <label className="space-y-0.5 text-slate-400">
                    <span>日</span>
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={billingDay}
                      onChange={(e) => setBillingDay(e.target.value)}
                      placeholder="1-31"
                      className="w-full px-1.5 py-1 rounded bg-white/8 border border-white/15 text-slate-100 font-mono"
                    />
                  </label>
                </div>
              ) : (
                <label className="space-y-0.5 text-slate-400">
                  <span>每月扣款日 (1-31)</span>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={billingDay}
                    onChange={(e) => setBillingDay(e.target.value)}
                    placeholder="例如 15"
                    className="w-full px-2 py-1 rounded bg-white/8 border border-white/15 text-slate-100 font-mono"
                  />
                </label>
              )}
            </div>

            <div className="flex items-center justify-end gap-1.5 pt-1">
              <button
                type="button"
                onClick={onStartEdit}
                className="px-2 py-1 rounded bg-white/10 text-slate-300 cursor-pointer"
              >
                取消
              </button>
              <button
                type="submit"
                className="px-2.5 py-1 rounded bg-sky-500/40 hover:bg-sky-500/55 text-white font-medium cursor-pointer"
              >
                儲存設定
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Card Footer Actions */}
      <div className="flex items-center justify-between gap-1.5 pt-1 border-t border-white/8 text-[0.72rem]">
        <button
          type="button"
          onClick={onStartEdit}
          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white/8 hover:bg-white/15 text-slate-200 cursor-pointer"
        >
          <Settings2 className="w-3.5 h-3.5" />
          費用／扣款日
        </button>

        <div className="flex items-center gap-1">
          {(item.grade === 'cancel_candidate' || item.grade === 'low') && !sub.isPaused && (
            <button
              type="button"
              onClick={onSnooze}
              title="30 天內不再發送此方案的低用量提醒"
              className="px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/35 text-amber-200 cursor-pointer"
            >
              本月忽略
            </button>
          )}
          <button
            type="button"
            onClick={() => onSaveSubscription({ ...sub, isPaused: !sub.isPaused })}
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white/8 hover:bg-white/15 text-slate-300 cursor-pointer"
          >
            {sub.isPaused ? (
              <>
                <PlayCircle className="w-3.5 h-3.5 text-emerald-300" />
                恢復追蹤
              </>
            ) : (
              <>
                <PauseCircle className="w-3.5 h-3.5 text-slate-400" />
                已停訂
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
