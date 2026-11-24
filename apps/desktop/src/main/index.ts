import { BrowserWindow, app, clipboard, dialog, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {
  APP_DATA_DIR_NAME,
  computeAccountAvailabilityScore,
  type AccountUpdateInput,
  type AnalyticsRange,
  type AppConfig,
  type CliWatcherStatus,
  type DashboardPayload,
  type DisplayMode,
  type ManualAdjustInput,
  type ProviderType,
  type SubscriptionCostDTO,
} from '@ai-quota/shared';
import { ConfigStore } from './config.js';
import { DatabaseRepository } from './db/repository.js';
import { LocalApiServer } from './server/localApiServer.js';
import { GeminiCliCollector } from './collectors/geminiCliCollector.js';
import { AntigravityCliCollector } from './collectors/antigravityCliCollector.js';
import { NotificationEngine } from './notifications/notificationEngine.js';
import { UpdateManager } from './updater/updateManager.js';
import { WindowManager, resolvePreloadPath } from './windowManager.js';

const APP_VERSION = '1.0.0';

// Required on Windows 10/11 so Electron native Toast notifications appear in Action Center
if (process.platform === 'win32') {
  app.setAppUserModelId('com.dong1121.ai-quota-dashboard');
}

// Enforce single instance so only one local HTTP server & DB owner runs
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let repository: DatabaseRepository | null = null;
let apiServer: LocalApiServer | null = null;
let geminiCollector: GeminiCliCollector | null = null;
let agyCollector: AntigravityCliCollector | null = null;
let notificationEngine: NotificationEngine | null = null;
let updateManager: UpdateManager | null = null;
let windowManager: WindowManager | null = null;

function getDataDir(): string {
  return path.join(app.getPath('appData'), APP_DATA_DIR_NAME);
}

async function bootstrap(): Promise<void> {
  const dataDir = getDataDir();
  const configStore = new ConfigStore(dataDir);
  const dbPath = path.join(dataDir, 'quota.db');

  repository = await DatabaseRepository.create(dbPath);

  const getWindowConfig = () => {
    const cfg = configStore.get();
    return {
      geminiCliDailyLimit: cfg.geminiCliDailyLimit,
      antigravityCliDailyLimit: cfg.antigravityCliDailyLimit,
    };
  };

  geminiCollector = new GeminiCliCollector(repository, getWindowConfig);
  agyCollector = new AntigravityCliCollector(repository, getWindowConfig);
  notificationEngine = new NotificationEngine(repository, () => configStore.get());
  updateManager = new UpdateManager(APP_VERSION);

  const getCliStatus = (): CliWatcherStatus => ({
    geminiCliFound: geminiCollector?.exists() ?? false,
    geminiCliPath: geminiCollector?.getBaseDir() ?? '',
    geminiCliLastScan: geminiCollector?.getLastScanAt() ?? null,
    antigravityCliFound: agyCollector?.exists() ?? false,
    antigravityCliPath: agyCollector?.getBaseDir() ?? '',
    antigravityCliLastScan: agyCollector?.getLastScanAt() ?? null,
  });

  const buildDashboardPayload = (): DashboardPayload => {
    const cfg = configStore.get();
    const rawAccounts = repository ? repository.getAccounts(false) : [];

    // Hide disabled CLI buckets cleanly so the UI only shows what the user enabled
    const filteredAccounts = rawAccounts
      .map((acct) => ({
        ...acct,
        buckets: acct.buckets.filter((b) => {
          if (b.bucketType === 'gemini_cli' && !cfg.enableGeminiCli) return false;
          if (b.bucketType === 'antigravity_cli' && !cfg.enableAntigravityCli) return false;
          return true;
        }),
      }))
      .filter((acct) => {
        if (
          acct.buckets.length === 0 &&
          (acct.identityKey === 'gemini-cli-local' || acct.identityKey === 'antigravity-local')
        ) {
          return false;
        }
        return true;
      });

    const accounts =
      cfg.sortMode === 'smart'
        ? [...filteredAccounts].sort(
            (a, b) => computeAccountAvailabilityScore(b) - computeAccountAvailabilityScore(a),
          )
        : filteredAccounts;

    return {
      accounts,
      hiddenAccounts: repository ? repository.getHiddenAccounts() : [],
      updatedAt: new Date().toISOString(),
      cliStatus: getCliStatus(),
    };
  };

  windowManager = new WindowManager(configStore);

  const pushDashboard = () => {
    notificationEngine?.onRepositoryChanged();
    windowManager?.broadcast('dashboard:updated', buildDashboardPayload());
  };

  repository.onChange(pushDashboard);
  updateManager.onChange((state) => {
    windowManager?.broadcast('updater:status', state);
  });

  // Start local loopback HTTP server
  apiServer = new LocalApiServer({
    port: configStore.get().port,
    version: APP_VERSION,
    getPairingToken: () => configStore.get().pairingToken,
    getWindowConfig,
    getCliStatus,
    repository,
  });

  try {
    await apiServer.start();
  } catch (err) {
    console.error('[desktop] Failed to bind local API server:', err);
  }

  // Start only enabled local CLI collectors (default: AGY CLI enabled, Gemini CLI disabled)
  const initialCfg = configStore.get();
  if (initialCfg.enableGeminiCli) {
    geminiCollector.start();
  }
  if (initialCfg.enableAntigravityCli) {
    agyCollector.start();
  }
  notificationEngine.start();

  // Optional silent update check 15 seconds after startup
  if (initialCfg.autoCheckUpdates) {
    setTimeout(() => {
      void updateManager?.checkForUpdates();
    }, 15_000);
  }

  // Register IPC handlers
  ipcMain.handle('dashboard:get', () => buildDashboardPayload());
  ipcMain.handle('config:get', () => configStore.get());
  ipcMain.handle('config:regenerate-token', () => {
    const next = configStore.regenerateToken();
    windowManager?.broadcast('config:updated', next);
    return next;
  });
  ipcMain.handle('config:reset', () => {
    const next = configStore.resetToDefaultsPreserveToken();
    windowManager?.broadcast('config:updated', next);
    windowManager?.broadcast('dashboard:updated', buildDashboardPayload());
    return next;
  });
  ipcMain.handle('config:update', async (_event, patch: Partial<AppConfig>) => {
    const prev = configStore.get();
    if (patch.shortcut && patch.shortcut !== prev.shortcut) {
      const ok = windowManager?.registerShortcut(patch.shortcut) ?? false;
      if (!ok) {
        return {
          ok: false,
          config: prev,
          error: `無法註冊快捷鍵 ${patch.shortcut}（可能與其他軟體衝突）`,
        };
      }
    }
    const next = configStore.update(patch);

    // Dynamically start/stop CLI collectors when toggled in Settings
    if (patch.enableGeminiCli !== undefined && patch.enableGeminiCli !== prev.enableGeminiCli) {
      if (next.enableGeminiCli) {
        geminiCollector?.start();
      } else {
        await geminiCollector?.stop();
      }
    }
    if (
      patch.enableAntigravityCli !== undefined &&
      patch.enableAntigravityCli !== prev.enableAntigravityCli
    ) {
      if (next.enableAntigravityCli) {
        agyCollector?.start();
      } else {
        await agyCollector?.stop();
      }
    }

    windowManager?.refreshTrayMenu();
    windowManager?.broadcast('config:updated', next);
    if (
      patch.sortMode !== undefined ||
      patch.enableGeminiCli !== undefined ||
      patch.enableAntigravityCli !== undefined
    ) {
      windowManager?.broadcast('dashboard:updated', buildDashboardPayload());
    }
    return { ok: true, config: next };
  });

  // Export / Import JSON settings backup (never exports pairingToken)
  ipcMain.handle('backup:export', async () => {
    const win = windowManager?.getWindow() ?? undefined;
    const result = await dialog.showSaveDialog(win as BrowserWindow, {
      title: '匯出 AI 額度儀表板設定備份',
      defaultPath: `ai-quota-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON 設定檔', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) {
      return { ok: false, message: '已取消匯出' };
    }

    const cfg = configStore.get();
    const { pairingToken: _omitToken, ...safeConfig } = cfg;
    const backup = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      config: safeConfig,
      subscriptions: repository ? Object.values(repository.getSubscriptionCosts()) : [],
      accountPreferences: repository
        ? repository.getAccounts(true).map((a) => ({
            provider: a.provider,
            identityKey: a.identityKey,
            displayName: a.displayName,
            colorTag: a.colorTag,
            isHidden: a.isHidden,
            notifyEnabled: a.notifyEnabled,
            sortOrder: a.sortOrder,
          }))
        : [],
    };
    fs.writeFileSync(result.filePath, JSON.stringify(backup, null, 2), 'utf-8');
    return { ok: true, filePath: result.filePath, message: '設定備份已匯出完成！' };
  });

  ipcMain.handle('backup:import', async () => {
    const win = windowManager?.getWindow() ?? undefined;
    const result = await dialog.showOpenDialog(win as BrowserWindow, {
      title: '匯入 AI 額度儀表板設定備份',
      properties: ['openFile'],
      filters: [{ name: 'JSON 設定檔', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePaths[0]) {
      return { ok: false, message: '已取消匯入' };
    }

    try {
      const raw = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf-8')) as {
        config?: Partial<AppConfig>;
        subscriptions?: SubscriptionCostDTO[];
        accountPreferences?: Array<{
          provider: ProviderType;
          identityKey: string;
          displayName: string;
          colorTag: string;
          isHidden: boolean;
          notifyEnabled: boolean;
          sortOrder: number;
        }>;
      };

      if (raw.config) {
        const { pairingToken: _ignore, ...safePatch } = raw.config;
        const nextCfg = configStore.update(safePatch);
        windowManager?.broadcast('config:updated', nextCfg);
      }

      if (Array.isArray(raw.subscriptions) && repository) {
        for (const sub of raw.subscriptions) {
          if (sub.provider) repository.upsertSubscriptionCost(sub);
        }
      }

      if (Array.isArray(raw.accountPreferences) && repository) {
        for (const pref of raw.accountPreferences) {
          if (!pref.provider || !pref.identityKey) continue;
          const id = repository.upsertAccount({
            provider: pref.provider,
            identityKey: pref.identityKey,
            displayName: pref.displayName,
            colorTag: pref.colorTag,
          });
          repository.updateAccount({
            id,
            displayName: pref.displayName,
            colorTag: pref.colorTag,
            isHidden: pref.isHidden,
            notifyEnabled: pref.notifyEnabled,
            sortOrder: pref.sortOrder,
          });
        }
      }

      windowManager?.broadcast('dashboard:updated', buildDashboardPayload());
      return { ok: true, message: '設定與訂閱資料已還原！' };
    } catch {
      return { ok: false, message: '匯入失敗：檔案格式無效' };
    }
  });

  ipcMain.handle('cli:rescan', () => {
    const cfg = configStore.get();
    if (cfg.enableGeminiCli) geminiCollector?.scanNow();
    if (cfg.enableAntigravityCli) agyCollector?.scanNow();
    const payload = buildDashboardPayload();
    pushDashboard();
    return payload;
  });
  ipcMain.handle('window:set-mode', (_event, mode: DisplayMode) => {
    const next = windowManager?.setMode(mode) ?? configStore.get();
    windowManager?.broadcast('config:updated', next);
    return next;
  });
  ipcMain.handle('window:set-pin', (_event, enabled: boolean) => {
    const next = windowManager?.setAlwaysOnTop(enabled) ?? configStore.get();
    windowManager?.broadcast('config:updated', next);
    return next;
  });
  ipcMain.handle('window:hide', () => {
    windowManager?.getWindow()?.hide();
  });
  ipcMain.handle('window:close-current', (event) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    senderWin?.close();
  });
  ipcMain.handle('window:open-analytics', () => {
    windowManager?.openAnalyticsWindow();
  });
  ipcMain.handle('clipboard:copy', (_event, text: string) => {
    clipboard.writeText(text);
  });

  ipcMain.handle('account:update', (_event, input: AccountUpdateInput) => {
    repository?.updateAccount(input);
    return buildDashboardPayload();
  });
  ipcMain.handle('account:reorder', (_event, orderedIds: string[]) => {
    repository?.reorderAccounts(orderedIds);
    return buildDashboardPayload();
  });
  ipcMain.handle('bucket:manual-adjust', (_event, input: ManualAdjustInput) => {
    repository?.manualAdjustBucket(input, getWindowConfig());
    return buildDashboardPayload();
  });

  ipcMain.handle('analytics:get', (_event, range: AnalyticsRange) => {
    const cfg = configStore.get();
    return repository!.getAnalyticsReport(range, cfg.notifications.idleDaysThreshold);
  });
  ipcMain.handle('subscription:upsert', (_event, sub: SubscriptionCostDTO) => {
    const saved = repository!.upsertSubscriptionCost(sub);
    windowManager?.broadcast('dashboard:updated', buildDashboardPayload());
    return saved;
  });
  ipcMain.handle('subscription:snooze', (_event, provider: ProviderType, days: number) => {
    const cur = repository!.getSubscriptionCosts()[provider];
    const snoozedUntil = new Date(Date.now() + days * 86_400_000).toISOString();
    return repository!.upsertSubscriptionCost({ ...cur, snoozedUntil });
  });
  ipcMain.handle('notification:test', (_event, kind?: 'recovery' | 'low_usage') => {
    return (
      notificationEngine?.sendTestNotification(kind ?? 'recovery') ?? {
        ok: false,
        message: '通知引擎尚未就緒',
      }
    );
  });

  // Auto-Update IPC
  ipcMain.handle('updater:state', () => updateManager!.getState());
  ipcMain.handle('updater:check', () => updateManager!.checkForUpdates());
  ipcMain.handle('updater:download', () => updateManager!.downloadUpdate());
  ipcMain.handle('updater:install', () => {
    windowManager?.markQuitting();
    updateManager?.quitAndInstall();
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  windowManager.createWindow(
    resolvePreloadPath(),
    devUrl ? { url: devUrl } : { file: path.join(__dirname, '../dist/index.html') },
  );
}

app.on('second-instance', () => {
  const win = windowManager?.getWindow();
  if (win) {
    if (!win.isVisible()) win.show();
    win.focus();
  }
});

app.on('window-all-closed', () => {
  // Stay resident in System Tray / macOS Menu Bar
});

app.whenReady().then(() => {
  void bootstrap();
});

app.on('before-quit', async () => {
  windowManager?.markQuitting();
  notificationEngine?.stop();
  windowManager?.cleanup();
  await Promise.allSettled([
    geminiCollector?.stop(),
    agyCollector?.stop(),
    apiServer?.stop(),
  ]);
  repository?.close();
});
