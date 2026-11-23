import React, { useEffect, useState } from 'react';
import type {
  AccountUpdateInput,
  AppConfig,
  DashboardPayload,
  DisplayMode,
  ManualAdjustInput,
  SortMode,
  UpdateStateDTO,
} from '@ai-quota/shared';
import { TitleBar } from './components/TitleBar.js';
import { AccountCard } from './components/AccountCard.js';
import { EmptyOnboarding } from './components/EmptyOnboarding.js';
import { SettingsPanel } from './components/SettingsPanel.js';

export const App: React.FC = () => {
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [updateState, setUpdateState] = useState<UpdateStateDTO | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const scale = config?.fontScale ?? 100;
    document.documentElement.style.fontSize = `${scale}%`;
  }, [config?.fontScale]);

  useEffect(() => {
    void window.quotaApi.getDashboard().then(setDashboard);
    void window.quotaApi.getConfig().then(setConfig);
    void window.quotaApi.getUpdateState().then(setUpdateState);

    const offDashboard = window.quotaApi.onDashboardUpdated((payload) => {
      setDashboard(payload);
    });
    const offConfig = window.quotaApi.onConfigUpdated((nextCfg) => {
      setConfig(nextCfg);
    });
    const offUpdate = window.quotaApi.onUpdateStateChanged((nextState) => {
      setUpdateState(nextState);
    });

    const tick = setInterval(() => {
      setNowMs(Date.now());
    }, 30_000);

    return () => {
      offDashboard();
      offConfig();
      offUpdate();
      clearInterval(tick);
    };
  }, []);

  const handleTogglePin = async () => {
    if (!config) return;
    const next = await window.quotaApi.setAlwaysOnTop(!config.alwaysOnTop);
    setConfig(next);
  };

  const handleToggleMode = async () => {
    if (!config) return;
    const nextMode: DisplayMode = config.mode === 'widget' ? 'tray' : 'widget';
    const next = await window.quotaApi.setMode(nextMode);
    setConfig(next);
  };

  const handleToggleSortMode = async () => {
    if (!config) return;
    const nextSort: SortMode = config.sortMode === 'smart' ? 'manual' : 'smart';
    const res = await window.quotaApi.updateConfig({ sortMode: nextSort });
    setConfig(res.config);
  };

  const handleRescanCli = async () => {
    setIsScanning(true);
    try {
      const next = await window.quotaApi.triggerCliRescan();
      setDashboard(next);
    } finally {
      setTimeout(() => setIsScanning(false), 450);
    }
  };

  const handleUpdateAccount = async (input: AccountUpdateInput) => {
    const next = await window.quotaApi.updateAccount(input);
    setDashboard(next);
  };

  const handleManualAdjust = async (input: ManualAdjustInput) => {
    const next = await window.quotaApi.manualAdjustBucket(input);
    setDashboard(next);
  };

  const accounts = dashboard?.accounts ?? [];
  const hiddenAccounts = dashboard?.hiddenAccounts ?? [];
  const canReorder = config?.sortMode !== 'smart';

  const handleMoveAccount = async (index: number, direction: 'up' | 'down') => {
    const swapIdx = direction === 'up' ? index - 1 : index + 1;
    if (swapIdx < 0 || swapIdx >= accounts.length) return;
    const ids = accounts.map((a) => a.id);
    const tmp = ids[index]!;
    ids[index] = ids[swapIdx]!;
    ids[swapIdx] = tmp;
    const next = await window.quotaApi.reorderAccounts(ids);
    setDashboard(next);
  };

  const shellStyle = {
    '--shell-alpha': (config?.widgetOpacity ?? 88) / 100,
  } as React.CSSProperties;

  return (
    <div className="h-full w-full p-1.5">
      <div
        className="glass-shell h-full w-full rounded-2xl flex flex-col overflow-hidden"
        style={shellStyle}
      >
        <TitleBar
          config={config}
          showSettings={showSettings}
          isScanning={isScanning}
          onTogglePin={() => void handleTogglePin()}
          onToggleMode={() => void handleToggleMode()}
          onToggleSortMode={() => void handleToggleSortMode()}
          onOpenAnalytics={() => void window.quotaApi.openAnalyticsWindow()}
          onRescanCli={() => void handleRescanCli()}
          onToggleSettings={() => setShowSettings((v) => !v)}
          onHide={() => void window.quotaApi.hideWindow()}
        />

        <main className="flex-1 overflow-y-auto custom-scroll p-3 space-y-2.5">
          {updateState &&
            (updateState.status === 'available' || updateState.status === 'downloaded') &&
            !showSettings && (
              <div className="rounded-xl bg-emerald-500/15 border border-emerald-400/35 px-3 py-2 flex items-center justify-between gap-2 text-[0.76rem]">
                <span className="text-emerald-200 truncate">
                  🎉 {updateState.status === 'downloaded' ? '新版已下載就緒' : `有新版本 v${updateState.latestVersion}`}
                </span>
                <button
                  type="button"
                  onClick={() => setShowSettings(true)}
                  className="px-2 py-0.5 rounded bg-emerald-500/30 hover:bg-emerald-500/45 text-emerald-100 shrink-0 cursor-pointer"
                >
                  前往更新
                </button>
              </div>
            )}

          {showSettings && config ? (
            <SettingsPanel
              config={config}
              cliStatus={dashboard?.cliStatus ?? null}
              hiddenAccounts={hiddenAccounts}
              updateState={updateState}
              onUpdateConfig={async (patch) => {
                const res = await window.quotaApi.updateConfig(patch);
                setConfig(res.config);
                return { ok: res.ok, error: res.error };
              }}
              onRegenerateToken={async () => {
                const next = await window.quotaApi.regenerateToken();
                setConfig(next);
              }}
              onResetSettings={async () => {
                const next = await window.quotaApi.resetSettings();
                setConfig(next);
              }}
              onExportBackup={() => window.quotaApi.exportBackup()}
              onImportBackup={() => window.quotaApi.importBackup()}
              onCheckUpdates={async () => {
                const st = await window.quotaApi.checkForUpdates();
                setUpdateState(st);
              }}
              onDownloadUpdate={async () => {
                const st = await window.quotaApi.downloadUpdate();
                setUpdateState(st);
              }}
              onInstallUpdate={() => window.quotaApi.installUpdate()}
              onSetMode={async (mode) => {
                const next = await window.quotaApi.setMode(mode);
                setConfig(next);
              }}
              onSetAlwaysOnTop={async (enabled) => {
                const next = await window.quotaApi.setAlwaysOnTop(enabled);
                setConfig(next);
              }}
              onRestoreAccount={(id) => void handleUpdateAccount({ id, isHidden: false })}
              onSendTestNotification={(kind) => window.quotaApi.sendTestNotification(kind)}
              onCopyText={(text) => void window.quotaApi.copyText(text)}
              onRescanCli={() => void handleRescanCli()}
            />
          ) : accounts.length === 0 ? (
            <EmptyOnboarding
              config={config}
              onCopyToken={(token) => void window.quotaApi.copyText(token)}
              onRescanCli={() => void handleRescanCli()}
            />
          ) : (
            accounts.map((account, idx) => (
              <AccountCard
                key={account.id}
                account={account}
                nowMs={nowMs}
                canReorder={canReorder}
                isFirst={idx === 0}
                isLast={idx === accounts.length - 1}
                onUpdateAccount={(input) => void handleUpdateAccount(input)}
                onMove={(dir) => void handleMoveAccount(idx, dir)}
                onManualAdjust={(input) => void handleManualAdjust(input)}
              />
            ))
          )}
        </main>

        <footer className="px-3.5 py-2 border-t border-white/8 flex items-center justify-between text-[0.75rem] text-slate-400/90 select-none">
          <span>
            {accounts.length > 0 ? `已追蹤 ${accounts.length} 個帳號` : 'Local-First · 離線就緒'}
          </span>
          <span className="font-mono text-slate-500">127.0.0.1:{config?.port ?? 17321}</span>
        </footer>
      </div>
    </div>
  );
};
