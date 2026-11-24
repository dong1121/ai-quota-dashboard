import React, { useEffect, useState } from 'react';
import { CheckCircle2, KeyRound, RefreshCw, Sparkles, WifiOff } from 'lucide-react';
import { DEFAULT_LOCAL_PORT, PROVIDER_META, maskEmail, type ProviderType } from '@ai-quota/shared';
import type { ExtensionRuntimeState } from '../shared/storage.js';
import type { ExtensionBgMessage } from '../shared/messages.js';

export const Popup: React.FC = () => {
  const [state, setState] = useState<ExtensionRuntimeState | null>(null);
  const [token, setToken] = useState('');
  const [port, setPort] = useState(String(DEFAULT_LOCAL_PORT));
  const [profileLabel, setProfileLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [syncingClaude, setSyncingClaude] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);

  const loadState = async () => {
    const res = (await chrome.runtime.sendMessage({
      type: 'GET_POPUP_STATE',
    } satisfies ExtensionBgMessage)) as ExtensionRuntimeState;
    setState(res);
    setToken(res.settings.pairingToken);
    setPort(String(res.settings.port));
    setProfileLabel(res.settings.profileLabel);
  };

  useEffect(() => {
    void loadState();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSyncNote(null);
    try {
      const parsedPort = Number(port) || DEFAULT_LOCAL_PORT;
      const res = (await chrome.runtime.sendMessage({
        type: 'SAVE_AND_TEST_SETTINGS',
        settings: {
          pairingToken: token.trim().toUpperCase(),
          port: parsedPort,
          profileLabel: profileLabel.trim(),
        },
      } satisfies ExtensionBgMessage)) as ExtensionRuntimeState;
      setState(res);
    } finally {
      setSaving(false);
    }
  };

  const handleSyncAll = async () => {
    setSyncingClaude(true);
    setSyncNote(null);
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'SCAN_OPEN_TABS',
      } satisfies ExtensionBgMessage)) as {
        scannedTabs: number;
        claudeOk: boolean;
        geminiOk?: boolean;
      };
      setTimeout(() => {
        void loadState();
      }, 1500);
      const synced: string[] = [];
      if (res.claudeOk) synced.push('Claude');
      if (res.geminiOk) synced.push('Gemini');
      if (res.scannedTabs > 0 || synced.length > 0) {
        setSyncNote(
          `已掃描 ${res.scannedTabs} 個分頁${synced.length > 0 ? `，背景同步成功：${synced.join(' / ')}` : ''}`,
        );
      } else {
        setSyncNote('未偵測到已登入或已開啟的 AI 分頁（使用獨立 App 者請在此瀏覽器登入一次網頁版）');
      }
    } finally {
      setSyncingClaude(false);
    }
  };

  const services = state?.services ?? {};
  const providers: ProviderType[] = ['claude', 'gemini', 'chatgpt'];

  return (
    <div className="p-3.5 space-y-3 text-slate-100 text-[12px]">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-sky-400 flex items-center justify-center shadow-md shadow-indigo-500/30">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-[13px] font-semibold leading-tight">AI 額度儀表板探針</h1>
            <p className="text-[10px] text-slate-400">
              Profile: {state?.settings.profileLabel || state?.settings.profileId || '...'}
            </p>
          </div>
        </div>

        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${
            state?.connected
              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/30'
              : 'bg-rose-500/20 text-rose-300 border-rose-400/30'
          }`}
        >
          {state?.connected ? (
            <>
              <CheckCircle2 className="w-3 h-3" /> 已連線
            </>
          ) : (
            <>
              <WifiOff className="w-3 h-3" /> 未連線
            </>
          )}
        </span>
      </header>

      {/* Notice if user loaded extension from an old manual folder instead of Desktop's auto-synced folder */}
      {state?.newerDesktopExtensionVersion && (
        <div className="rounded-lg bg-amber-500/15 border border-amber-400/35 px-2.5 py-2 text-[11px] text-amber-200 leading-snug">
          桌面端已內建新版擴充套件 <strong>v{state.newerDesktopExtensionVersion}</strong>（目前 v
          {state.extensionVersion}）。改載入桌面端設定頁的「📂 內建擴充套件資料夾」，以後就能全自動更新！
        </div>
      )}

      {/* Pairing Form */}
      <form
        onSubmit={(e) => void handleSave(e)}
        className="rounded-xl bg-white/[0.045] border border-white/10 p-3 space-y-2.5"
      >
        <div className="space-y-1">
          <label className="flex items-center gap-1 text-[11px] text-slate-300">
            <KeyRound className="w-3 h-3 text-amber-300" />
            <span>本機配對碼（來自桌面小工具）</span>
          </label>
          <input
            type="text"
            placeholder="例如 K8M2-94Q1"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="w-full px-2.5 py-1.5 rounded-lg bg-black/40 border border-white/15 text-amber-200 font-mono text-xs tracking-wider focus:outline-none focus:border-indigo-400"
          />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2 space-y-1">
            <label className="text-[10px] text-slate-400">視窗標籤（選填）</label>
            <input
              type="text"
              placeholder="如：Chrome 藍窗"
              value={profileLabel}
              onChange={(e) => setProfileLabel(e.target.value)}
              className="w-full px-2 py-1 rounded-lg bg-black/40 border border-white/15 text-[11px] text-slate-100 focus:outline-none focus:border-indigo-400"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-slate-400">本機埠</label>
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              className="w-full px-2 py-1 rounded-lg bg-black/40 border border-white/15 text-[11px] text-slate-100 font-mono focus:outline-none focus:border-indigo-400"
            />
          </div>
        </div>

        {state?.lastError && (
          <p className="text-[11px] text-rose-300 leading-snug">{state.lastError}</p>
        )}

        <button
          type="submit"
          disabled={saving}
          className="w-full py-1.5 px-3 rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 text-white font-medium text-[11px] transition-colors cursor-pointer"
        >
          {saving ? '連線驗證中...' : '儲存並測試連線'}
        </button>
      </form>

      {/* Detected Services in this Chrome Profile */}
      <section className="rounded-xl bg-white/[0.045] border border-white/10 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-slate-200">此設定檔已偵測服務</span>
          <button
            type="button"
            onClick={() => void handleSyncAll()}
            disabled={syncingClaude || !state?.connected}
            className="inline-flex items-center gap-1 text-[10px] text-sky-300 hover:text-sky-200 disabled:opacity-40 cursor-pointer"
          >
            <RefreshCw className={`w-3 h-3 ${syncingClaude ? 'animate-spin' : ''}`} />
            <span>掃描分頁並同步</span>
          </button>
        </div>

        <div className="space-y-1.5">
          {providers.map((p) => {
            const rec = services[p];
            return (
              <div
                key={p}
                className="flex items-center justify-between text-[11px] py-1 border-b border-white/5 last:border-b-0"
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: PROVIDER_META[p].defaultColor }}
                  />
                  <span className="text-slate-200">{PROVIDER_META[p].name}</span>
                </div>
                <span className="text-[10px] text-slate-400 truncate max-w-[165px]">
                  {rec ? `${maskEmail(rec.identityKey)}${rec.note ? ` · ${rec.note}` : ''}` : '開啟網頁即自動偵測'}
                </span>
              </div>
            );
          })}
        </div>

        {syncNote && <p className="text-[10px] text-sky-300">{syncNote}</p>}
      </section>
    </div>
  );
};
