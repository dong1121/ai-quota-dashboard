import React, { useState } from 'react';
import {
  Bell,
  Check,
  Copy,
  Download,
  Eye,
  FolderDown,
  FolderUp,
  Keyboard,
  Moon,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Terminal,
  Type,
} from 'lucide-react';
import {
  MAX_FONT_SCALE,
  MAX_WIDGET_OPACITY,
  MIN_FONT_SCALE,
  MIN_WIDGET_OPACITY,
  PROVIDER_META,
  type AccountDTO,
  type AppConfig,
  type CliWatcherStatus,
  type DisplayMode,
  type NotificationSettings,
  type UpdateStateDTO,
} from '@ai-quota/shared';

interface SettingsPanelProps {
  config: AppConfig;
  cliStatus: CliWatcherStatus | null;
  hiddenAccounts: AccountDTO[];
  updateState: UpdateStateDTO | null;
  onUpdateConfig: (patch: Partial<AppConfig>) => Promise<{ ok: boolean; error?: string }>;
  onRegenerateToken: () => Promise<void>;
  onResetSettings: () => Promise<void>;
  onExportBackup: () => Promise<{ ok: boolean; message: string }>;
  onImportBackup: () => Promise<{ ok: boolean; message: string }>;
  onCheckUpdates: () => Promise<void>;
  onDownloadUpdate: () => Promise<void>;
  onInstallUpdate: () => Promise<void>;
  onOpenExtensionFolder: () => Promise<{ ok: boolean; path: string }>;
  onSetMode: (mode: DisplayMode) => Promise<void>;
  onSetAlwaysOnTop: (enabled: boolean) => Promise<void>;
  onRestoreAccount: (accountId: string) => void;
  onSendTestNotification: (
    kind: 'recovery' | 'low_usage',
  ) => Promise<{ ok: boolean; message: string }>;
  onCopyText: (text: string) => void;
  onRescanCli: () => void;
}

const FONT_PRESETS = [
  { label: '精巧', scale: 90 },
  { label: '標準', scale: 100 },
  { label: '大字', scale: 115 },
  { label: '特大', scale: 130 },
] as const;

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  config,
  cliStatus,
  hiddenAccounts,
  updateState,
  onUpdateConfig,
  onRegenerateToken,
  onResetSettings,
  onExportBackup,
  onImportBackup,
  onCheckUpdates,
  onDownloadUpdate,
  onInstallUpdate,
  onOpenExtensionFolder,
  onSetMode,
  onSetAlwaysOnTop,
  onRestoreAccount,
  onSendTestNotification,
  onCopyText,
  onRescanCli,
}) => {
  const [copied, setCopied] = useState(false);
  const [shortcutDraft, setShortcutDraft] = useState(config.shortcut);
  const [shortcutFeedback, setShortcutFeedback] = useState<string | null>(null);
  const [notifFeedback, setNotifFeedback] = useState<string | null>(null);
  const [backupFeedback, setBackupFeedback] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const handleTestNotif = async (kind: 'recovery' | 'low_usage') => {
    setNotifFeedback(null);
    const res = await onSendTestNotification(kind);
    setNotifFeedback(res.message);
    setTimeout(() => setNotifFeedback(null), 5000);
  };

  const handleCopy = () => {
    onCopyText(config.pairingToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleSaveShortcut = async () => {
    setShortcutFeedback(null);
    const res = await onUpdateConfig({ shortcut: shortcutDraft.trim() });
    if (res.ok) {
      setShortcutFeedback('已套用新快捷鍵');
      setTimeout(() => setShortcutFeedback(null), 2000);
    } else {
      setShortcutFeedback(res.error ?? '快捷鍵註冊失敗');
    }
  };

  const handleFontScale = (scale: number) => {
    document.documentElement.style.fontSize = `${scale}%`;
    void onUpdateConfig({ fontScale: scale });
  };

  const updateNotif = (patch: Partial<NotificationSettings>) => {
    void onUpdateConfig({
      notifications: {
        ...config.notifications,
        ...patch,
      },
    });
  };

  const handleBackupAction = async (fn: () => Promise<{ ok: boolean; message: string }>) => {
    const res = await fn();
    setBackupFeedback(res.message);
    setTimeout(() => setBackupFeedback(null), 4000);
  };

  const notif = config.notifications;

  return (
    <div className="space-y-3 text-[0.85rem]">
      {/* Font Size & Opacity */}
      <section className="glass-card rounded-xl p-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-slate-200 font-semibold">
            <Type className="w-4 h-4 text-sky-300" />
            <span>顯示字體與透明度</span>
          </div>
          <span className="text-[0.8rem] font-mono font-semibold text-sky-300 tabular-nums">
            {config.fontScale}%
          </span>
        </div>

        <div className="grid grid-cols-4 gap-1.5">
          {FONT_PRESETS.map((preset) => {
            const active = config.fontScale === preset.scale;
            return (
              <button
                key={preset.scale}
                type="button"
                onClick={() => handleFontScale(preset.scale)}
                className={`py-1.5 px-1 rounded-lg text-[0.78rem] font-medium border transition-colors cursor-pointer ${
                  active
                    ? 'bg-sky-500/30 border-sky-400/50 text-white'
                    : 'bg-white/5 border-white/10 text-slate-300 hover:text-white hover:bg-white/10'
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 pt-0.5">
          <span className="text-[0.72rem] text-slate-400 shrink-0">A</span>
          <input
            type="range"
            min={MIN_FONT_SCALE}
            max={MAX_FONT_SCALE}
            step={5}
            value={config.fontScale}
            onChange={(e) => handleFontScale(Number(e.target.value))}
            className="flex-1 accent-sky-400 cursor-pointer"
          />
          <span className="text-[0.95rem] font-semibold text-slate-200 shrink-0">A</span>
        </div>

        <div className="pt-2 border-t border-white/8 space-y-1.5">
          <div className="flex items-center justify-between text-[0.78rem]">
            <span className="text-slate-300">看板背景不透明度</span>
            <span className="font-mono text-sky-300 tabular-nums">{config.widgetOpacity}%</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[0.7rem] text-slate-400 shrink-0">透亮</span>
            <input
              type="range"
              min={MIN_WIDGET_OPACITY}
              max={MAX_WIDGET_OPACITY}
              step={2}
              value={config.widgetOpacity}
              onChange={(e) => void onUpdateConfig({ widgetOpacity: Number(e.target.value) })}
              className="flex-1 accent-indigo-400 cursor-pointer"
            />
            <span className="text-[0.7rem] text-slate-300 shrink-0">實色</span>
          </div>
        </div>
      </section>

      {/* Software Update (GitHub Releases Auto-Update) */}
      <section className="glass-card rounded-xl p-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-slate-200 font-semibold">
            <Download className="w-4 h-4 text-emerald-300" />
            <span>版本與自動更新</span>
          </div>
          <span className="text-[0.72rem] font-mono text-slate-400">
            v{updateState?.currentVersion ?? '0.3.0'}
          </span>
        </div>

        <label className="flex items-center justify-between text-[0.78rem] text-slate-300 cursor-pointer">
          <span>啟動時自動檢查 GitHub 新版本</span>
          <input
            type="checkbox"
            checked={config.autoCheckUpdates}
            onChange={(e) => void onUpdateConfig({ autoCheckUpdates: e.target.checked })}
            className="accent-emerald-400 w-3.5 h-3.5 cursor-pointer"
          />
        </label>

        {updateState?.message && (
          <p className="text-[0.74rem] text-sky-200 bg-sky-500/10 border border-sky-400/20 rounded-md px-2 py-1.5">
            {updateState.message}
          </p>
        )}

        {updateState?.status === 'downloading' && (
          <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-sky-400 to-emerald-400 transition-all"
              style={{ width: `${updateState.downloadPercent ?? 0}%` }}
            />
          </div>
        )}

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={updateState?.status === 'checking' || updateState?.status === 'downloading'}
            onClick={() => void onCheckUpdates()}
            className="flex-1 py-1.5 px-2.5 rounded-lg bg-white/10 hover:bg-white/18 disabled:opacity-50 text-[0.76rem] text-slate-100 font-medium cursor-pointer"
          >
            {updateState?.status === 'checking' ? '檢查中…' : '檢查更新'}
          </button>

          {updateState?.status === 'available' && (
            <button
              type="button"
              onClick={() => void onDownloadUpdate()}
              className="flex-1 py-1.5 px-2.5 rounded-lg bg-emerald-500/35 hover:bg-emerald-500/50 border border-emerald-400/40 text-[0.76rem] text-emerald-100 font-medium cursor-pointer"
            >
              {updateState.canAutoInstall ? '自動下載更新' : '前往下載新版'}
            </button>
          )}

          {updateState?.status === 'downloaded' && (
            <button
              type="button"
              onClick={() => void onInstallUpdate()}
              className="flex-1 py-1.5 px-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-[0.76rem] text-slate-950 font-semibold cursor-pointer"
            >
              立即重啟並更新
            </button>
          )}
        </div>
      </section>

      {/* Dual Notification Engine */}
      <section className="glass-card rounded-xl p-3 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-slate-200 font-semibold">
            <Bell className="w-4 h-4 text-amber-300" />
            <span>提醒與省錢體檢通知</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void handleTestNotif('recovery')}
              className="text-[0.7rem] px-1.5 py-0.5 rounded bg-white/10 hover:bg-emerald-500/25 text-emerald-200 cursor-pointer"
            >
              測試滿血
            </button>
            <button
              type="button"
              onClick={() => void handleTestNotif('low_usage')}
              className="text-[0.7rem] px-1.5 py-0.5 rounded bg-white/10 hover:bg-amber-500/25 text-amber-200 cursor-pointer"
            >
              測試停訂
            </button>
          </div>
        </div>

        {notifFeedback && (
          <p className="text-[0.72rem] text-sky-300 bg-sky-500/10 border border-sky-400/20 rounded-md px-2 py-1">
            {notifFeedback}
          </p>
        )}

        <label className="flex items-center justify-between text-[0.8rem] text-slate-200 cursor-pointer">
          <span>啟用系統原生通知</span>
          <input
            type="checkbox"
            checked={notif.enabled}
            onChange={(e) => updateNotif({ enabled: e.target.checked })}
            className="accent-indigo-400 w-4 h-4 cursor-pointer"
          />
        </label>

        {notif.enabled && (
          <div className="space-y-2 pt-1 border-t border-white/8 text-[0.78rem]">
            <label className="flex items-center justify-between text-slate-300 cursor-pointer">
              <span>⚡ 額度滿血復活通知</span>
              <input
                type="checkbox"
                checked={notif.fullRecoveryEnabled}
                onChange={(e) => updateNotif({ fullRecoveryEnabled: e.target.checked })}
                className="accent-emerald-400 w-3.5 h-3.5 cursor-pointer"
              />
            </label>

            <label className="flex items-center justify-between text-slate-300 cursor-pointer">
              <span>💰 低用量／扣款前停訂體檢通知</span>
              <input
                type="checkbox"
                checked={notif.lowUsageEnabled}
                onChange={(e) => updateNotif({ lowUsageEnabled: e.target.checked })}
                className="accent-amber-400 w-3.5 h-3.5 cursor-pointer"
              />
            </label>

            {notif.lowUsageEnabled && (
              <div className="grid grid-cols-3 gap-1.5 pt-0.5">
                <label className="space-y-0.5 text-[0.7rem] text-slate-400">
                  <span>閒置天數</span>
                  <input
                    type="number"
                    min={3}
                    max={60}
                    value={notif.idleDaysThreshold}
                    onChange={(e) =>
                      updateNotif({ idleDaysThreshold: Math.max(3, Number(e.target.value) || 14) })
                    }
                    className="w-full px-1.5 py-1 rounded bg-black/35 border border-white/12 text-slate-100 font-mono"
                  />
                </label>
                <label className="space-y-0.5 text-[0.7rem] text-slate-400">
                  <span>月繳前 N 天</span>
                  <input
                    type="number"
                    min={1}
                    max={14}
                    value={notif.monthlyRemindDaysBefore}
                    onChange={(e) =>
                      updateNotif({
                        monthlyRemindDaysBefore: Math.max(1, Number(e.target.value) || 3),
                      })
                    }
                    className="w-full px-1.5 py-1 rounded bg-black/35 border border-white/12 text-slate-100 font-mono"
                  />
                </label>
                <label className="space-y-0.5 text-[0.7rem] text-slate-400">
                  <span>年繳前 N 天</span>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={notif.yearlyRemindDaysBefore}
                    onChange={(e) =>
                      updateNotif({
                        yearlyRemindDaysBefore: Math.max(1, Number(e.target.value) || 7),
                      })
                    }
                    className="w-full px-1.5 py-1 rounded bg-black/35 border border-white/12 text-slate-100 font-mono"
                  />
                </label>
              </div>
            )}

            <div className="pt-1 border-t border-white/8 space-y-1.5">
              <label className="flex items-center justify-between text-slate-300 cursor-pointer">
                <span className="inline-flex items-center gap-1">
                  <Moon className="w-3.5 h-3.5 text-indigo-300" />
                  夜間勿擾時段
                </span>
                <input
                  type="checkbox"
                  checked={notif.quietHoursEnabled}
                  onChange={(e) => updateNotif({ quietHoursEnabled: e.target.checked })}
                  className="accent-indigo-400 w-3.5 h-3.5 cursor-pointer"
                />
              </label>

              {notif.quietHoursEnabled && (
                <div className="flex items-center gap-2 text-[0.74rem] text-slate-300">
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={notif.quietStartHour}
                    onChange={(e) =>
                      updateNotif({
                        quietStartHour: Math.max(0, Math.min(23, Number(e.target.value) || 0)),
                      })
                    }
                    className="w-14 px-2 py-0.5 rounded bg-black/35 border border-white/12 text-center font-mono"
                  />
                  <span>:00 至</span>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={notif.quietEndHour}
                    onChange={(e) =>
                      updateNotif({
                        quietEndHour: Math.max(0, Math.min(23, Number(e.target.value) || 0)),
                      })
                    }
                    className="w-14 px-2 py-0.5 rounded bg-black/35 border border-white/12 text-center font-mono"
                  />
                  <span>:00 靜音</span>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Local CLI Watchers (AGY default ON, Gemini CLI default OFF) */}
      <section className="glass-card rounded-xl p-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-slate-200 font-semibold">
            <Terminal className="w-4 h-4 text-sky-300" />
            <span>本機 CLI 監看設定</span>
          </div>
          <button
            type="button"
            onClick={onRescanCli}
            className="text-[0.75rem] text-sky-300 hover:text-sky-200 underline cursor-pointer"
          >
            立即掃描
          </button>
        </div>

        <div className="space-y-2 text-[0.78rem]">
          <label className="flex items-center justify-between gap-2 text-slate-200 cursor-pointer">
            <div>
              <span>🚀 監看 Antigravity (CLI / 桌面應用程式)</span>
              <span className="block text-[0.68rem] text-slate-400">
                {cliStatus?.antigravityCliFound ? '● 已偵測本機紀錄目錄' : '○ 未偵測目錄'}
              </span>
            </div>
            <input
              type="checkbox"
              checked={config.enableAntigravityCli}
              onChange={(e) => void onUpdateConfig({ enableAntigravityCli: e.target.checked })}
              className="accent-sky-400 w-4 h-4 cursor-pointer"
            />
          </label>

          <label className="flex items-center justify-between gap-2 text-slate-300 cursor-pointer pt-1.5 border-t border-white/6">
            <div>
              <span>💻 監看標準 Gemini CLI（選用）</span>
              <span className="block text-[0.68rem] text-slate-400">
                適合免費額度使用者，預設關閉保持版面精簡
              </span>
            </div>
            <input
              type="checkbox"
              checked={config.enableGeminiCli}
              onChange={(e) => void onUpdateConfig({ enableGeminiCli: e.target.checked })}
              className="accent-sky-400 w-4 h-4 cursor-pointer"
            />
          </label>
        </div>
      </section>

      {/* Hidden Accounts Recovery */}
      {hiddenAccounts.length > 0 && (
        <section className="glass-card rounded-xl p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-slate-200 font-semibold">
            <Eye className="w-4 h-4 text-slate-300" />
            <span>已隱藏的帳號（{hiddenAccounts.length}）</span>
          </div>
          <div className="space-y-1.5">
            {hiddenAccounts.map((acc) => (
              <div
                key={acc.id}
                className="flex items-center justify-between gap-2 text-[0.78rem] py-1 border-b border-white/5 last:border-b-0"
              >
                <span className="text-slate-300 truncate">
                  {PROVIDER_META[acc.provider].badgeText} · {acc.displayName}
                </span>
                <button
                  type="button"
                  onClick={() => onRestoreAccount(acc.id)}
                  className="px-2 py-0.5 rounded bg-white/10 hover:bg-emerald-500/30 text-emerald-200 text-[0.72rem] shrink-0 cursor-pointer"
                >
                  恢復顯示
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Pairing Token & Local Server */}
      <section className="glass-card rounded-xl p-3 space-y-2.5">
        <div className="flex items-center gap-1.5 text-slate-200 font-semibold">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>本機配對授權（Local-First）</span>
        </div>

        <div className="flex items-center justify-between text-[0.78rem] text-slate-400">
          <span>監聽位址</span>
          <code className="text-sky-300 font-mono">http://127.0.0.1:{config.port}</code>
        </div>

        <div className="flex items-center justify-between gap-2 rounded-lg bg-black/35 border border-white/10 px-2.5 py-2">
          <code className="text-[0.95rem] font-bold tracking-[0.18em] text-amber-200 font-mono">
            {config.pairingToken}
          </code>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white/10 hover:bg-white/20 text-[0.78rem] text-slate-100 cursor-pointer"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-emerald-300" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>{copied ? '已複製' : '複製'}</span>
            </button>
            <button
              type="button"
              onClick={() => void onRegenerateToken()}
              title="重新產生配對碼（Chrome 擴充套件需重新輸入）"
              className="p-1.5 rounded-md bg-white/10 hover:bg-rose-500/25 text-slate-300 hover:text-rose-200 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void onOpenExtensionFolder()}
          className="w-full py-1.5 px-2.5 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/32 border border-indigo-400/30 text-[0.76rem] text-indigo-100 font-medium cursor-pointer transition-colors"
        >
          📂 開啟內建 Chrome / Edge 擴充套件資料夾（自動跟隨更新）
        </button>
      </section>

      {/* Window Mode & Shortcut */}
      <section className="glass-card rounded-xl p-3 space-y-3">
        <div className="flex items-center gap-1.5 text-slate-200 font-semibold">
          <Keyboard className="w-4 h-4 text-indigo-300" />
          <span>顯示模式與全域快捷鍵</span>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => void onSetMode('widget')}
            className={`py-1.5 px-2 rounded-lg text-[0.78rem] font-medium border transition-colors cursor-pointer ${
              config.mode === 'widget'
                ? 'bg-indigo-500/30 border-indigo-400/50 text-white'
                : 'bg-white/5 border-white/10 text-slate-400 hover:text-slate-200'
            }`}
          >
            桌面迷你看板
          </button>
          <button
            type="button"
            onClick={() => void onSetMode('tray')}
            className={`py-1.5 px-2 rounded-lg text-[0.78rem] font-medium border transition-colors cursor-pointer ${
              config.mode === 'tray'
                ? 'bg-indigo-500/30 border-indigo-400/50 text-white'
                : 'bg-white/5 border-white/10 text-slate-400 hover:text-slate-200'
            }`}
          >
            系統列常駐
          </button>
        </div>

        <label className="flex items-center justify-between text-[0.8rem] text-slate-300 cursor-pointer">
          <span>總是置頂 (Always on Top)</span>
          <input
            type="checkbox"
            checked={config.alwaysOnTop}
            onChange={(e) => void onSetAlwaysOnTop(e.target.checked)}
            className="accent-indigo-400 w-4 h-4 cursor-pointer"
          />
        </label>

        <div className="space-y-1.5">
          <span className="text-[0.76rem] text-slate-400">
            喚出快捷鍵（例：Alt+Q、Ctrl+Shift+Q）
          </span>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={shortcutDraft}
              onChange={(e) => setShortcutDraft(e.target.value)}
              className="flex-1 px-2.5 py-1.5 rounded-lg bg-black/35 border border-white/15 text-[0.8rem] text-slate-100 font-mono focus:outline-none focus:border-indigo-400"
            />
            <button
              type="button"
              onClick={() => void handleSaveShortcut()}
              className="px-2.5 py-1.5 rounded-lg bg-indigo-500/30 hover:bg-indigo-500/45 border border-indigo-400/40 text-[0.78rem] text-indigo-100 cursor-pointer"
            >
              套用
            </button>
          </div>
          {shortcutFeedback && <p className="text-[0.74rem] text-sky-300">{shortcutFeedback}</p>}
        </div>
      </section>

      {/* Backup Export / Import / Reset */}
      <section className="glass-card rounded-xl p-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-slate-200 font-semibold">設定備份與還原</span>
          <span className="text-[0.68rem] text-slate-400">不含配對碼，換機安全</span>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => void handleBackupAction(onExportBackup)}
            className="inline-flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg bg-white/8 hover:bg-white/15 text-[0.76rem] text-slate-200 cursor-pointer"
          >
            <FolderDown className="w-3.5 h-3.5 text-sky-300" />
            匯出設定
          </button>
          <button
            type="button"
            onClick={() => void handleBackupAction(onImportBackup)}
            className="inline-flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg bg-white/8 hover:bg-white/15 text-[0.76rem] text-slate-200 cursor-pointer"
          >
            <FolderUp className="w-3.5 h-3.5 text-emerald-300" />
            匯入還原
          </button>
        </div>

        {backupFeedback && <p className="text-[0.74rem] text-sky-300">{backupFeedback}</p>}

        <div className="pt-1 border-t border-white/8 flex items-center justify-between">
          <span className="text-[0.72rem] text-slate-400">恢復外觀與通知預設值</span>
          {confirmReset ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setConfirmReset(false);
                  void onResetSettings();
                }}
                className="px-2 py-0.5 rounded bg-rose-500/40 text-rose-100 text-[0.72rem] cursor-pointer"
              >
                確認重置
              </button>
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                className="px-2 py-0.5 rounded bg-white/10 text-slate-300 text-[0.72rem] cursor-pointer"
              >
                取消
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white/6 hover:bg-rose-500/20 text-slate-300 hover:text-rose-200 text-[0.72rem] cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              重置設定
            </button>
          )}
        </div>
      </section>
    </div>
  );
};
