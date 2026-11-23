import React from 'react';
import {
  ArrowUpDown,
  BarChart3,
  Minimize2,
  PanelTop,
  Pin,
  PinOff,
  RefreshCw,
  Settings,
  Sparkles,
  X,
} from 'lucide-react';
import type { AppConfig } from '@ai-quota/shared';

interface TitleBarProps {
  config: AppConfig | null;
  showSettings: boolean;
  isScanning: boolean;
  onTogglePin: () => void;
  onToggleMode: () => void;
  onToggleSortMode: () => void;
  onOpenAnalytics: () => void;
  onRescanCli: () => void;
  onToggleSettings: () => void;
  onHide: () => void;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  config,
  showSettings,
  isScanning,
  onTogglePin,
  onToggleMode,
  onToggleSortMode,
  onOpenAnalytics,
  onRescanCli,
  onToggleSettings,
  onHide,
}) => {
  const isPinned = Boolean(config?.alwaysOnTop);
  const isTrayMode = config?.mode === 'tray';
  const isSmartSort = config?.sortMode === 'smart';

  return (
    <header className="app-drag flex items-center justify-between px-3.5 py-2.5 border-b border-white/10 select-none">
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-indigo-500 to-sky-400 flex items-center justify-center shadow-md shadow-indigo-500/30 shrink-0">
          <Sparkles className="w-3.5 h-3.5 text-white" />
        </div>
        <div className="truncate">
          <h1 className="text-[0.95rem] font-semibold tracking-wide text-slate-100 leading-tight">
            AI 額度看板
          </h1>
          <p className="text-[0.72rem] text-slate-400 leading-tight">
            {isTrayMode ? `系統列 · ${config?.shortcut ?? 'Alt+Q'}` : '桌面常駐'}
            {isSmartSort ? ' · 智慧排序' : ''}
          </p>
        </div>
      </div>

      <div className="app-no-drag flex items-center gap-0.5">
        <button
          type="button"
          onClick={onOpenAnalytics}
          title="開啟用量統計與訂閱 CP 值體檢視窗"
          className="p-1.5 rounded-lg text-sky-300/90 hover:text-sky-200 hover:bg-sky-400/15 transition-colors cursor-pointer"
        >
          <BarChart3 className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={onToggleSortMode}
          title={isSmartSort ? '目前：智慧排序（點擊改為手動排序）' : '目前：手動排序（點擊開啟智慧排序：滿血排最前）'}
          className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
            isSmartSort
              ? 'text-emerald-300 bg-emerald-400/15 hover:bg-emerald-400/25'
              : 'text-slate-300/80 hover:text-white hover:bg-white/10'
          }`}
        >
          <ArrowUpDown className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          onClick={onRescanCli}
          title="立即重新掃描本機 CLI 紀錄"
          className="p-1.5 rounded-lg text-slate-300/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin text-sky-400' : ''}`} />
        </button>

        <button
          type="button"
          onClick={onTogglePin}
          title={isPinned ? '取消總是置頂' : '開啟總是置頂'}
          className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
            isPinned
              ? 'text-amber-300 bg-amber-400/15 hover:bg-amber-400/25'
              : 'text-slate-300/80 hover:text-white hover:bg-white/10'
          }`}
        >
          {isPinned ? <Pin className="w-3.5 h-3.5" /> : <PinOff className="w-3.5 h-3.5" />}
        </button>

        <button
          type="button"
          onClick={onToggleMode}
          title={isTrayMode ? '切換為桌面常駐看板' : '收合至系統列常駐 (Alt+Q 喚出)'}
          className="p-1.5 rounded-lg text-slate-300/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
        >
          {isTrayMode ? <PanelTop className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
        </button>

        <button
          type="button"
          onClick={onToggleSettings}
          title="設定、通知與配對碼"
          className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
            showSettings
              ? 'text-indigo-300 bg-indigo-500/25'
              : 'text-slate-300/80 hover:text-white hover:bg-white/10'
          }`}
        >
          {showSettings ? <X className="w-3.5 h-3.5" /> : <Settings className="w-3.5 h-3.5" />}
        </button>

        {isTrayMode && (
          <button
            type="button"
            onClick={onHide}
            title="隱藏至系統列"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </header>
  );
};
