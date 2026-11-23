import { contextBridge, ipcRenderer } from 'electron';
import type {
  AccountUpdateInput,
  AnalyticsRange,
  AnalyticsReportDTO,
  AppConfig,
  DashboardPayload,
  DisplayMode,
  ManualAdjustInput,
  ProviderType,
  SubscriptionCostDTO,
  UpdateStateDTO,
} from '@ai-quota/shared';

export interface QuotaDesktopBridge {
  getDashboard: () => Promise<DashboardPayload>;
  onDashboardUpdated: (callback: (payload: DashboardPayload) => void) => () => void;
  getConfig: () => Promise<AppConfig>;
  onConfigUpdated: (callback: (config: AppConfig) => void) => () => void;
  updateConfig: (
    patch: Partial<AppConfig>,
  ) => Promise<{ ok: boolean; config: AppConfig; error?: string }>;
  regenerateToken: () => Promise<AppConfig>;
  resetSettings: () => Promise<AppConfig>;
  exportBackup: () => Promise<{ ok: boolean; filePath?: string; message: string }>;
  importBackup: () => Promise<{ ok: boolean; message: string }>;
  triggerCliRescan: () => Promise<DashboardPayload>;
  setMode: (mode: DisplayMode) => Promise<AppConfig>;
  setAlwaysOnTop: (enabled: boolean) => Promise<AppConfig>;
  hideWindow: () => Promise<void>;
  closeCurrentWindow: () => Promise<void>;
  openAnalyticsWindow: () => Promise<void>;
  copyText: (text: string) => Promise<void>;
  updateAccount: (input: AccountUpdateInput) => Promise<DashboardPayload>;
  reorderAccounts: (orderedIds: string[]) => Promise<DashboardPayload>;
  manualAdjustBucket: (input: ManualAdjustInput) => Promise<DashboardPayload>;
  getAnalytics: (range: AnalyticsRange) => Promise<AnalyticsReportDTO>;
  upsertSubscriptionCost: (sub: SubscriptionCostDTO) => Promise<SubscriptionCostDTO>;
  snoozeSubscription: (provider: ProviderType, days: number) => Promise<SubscriptionCostDTO>;
  sendTestNotification: (
    kind?: 'recovery' | 'low_usage',
  ) => Promise<{ ok: boolean; message: string }>;
  getUpdateState: () => Promise<UpdateStateDTO>;
  onUpdateStateChanged: (callback: (state: UpdateStateDTO) => void) => () => void;
  checkForUpdates: () => Promise<UpdateStateDTO>;
  downloadUpdate: () => Promise<UpdateStateDTO>;
  installUpdate: () => Promise<void>;
}

const api: QuotaDesktopBridge = {
  getDashboard: () => ipcRenderer.invoke('dashboard:get'),
  onDashboardUpdated: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: DashboardPayload) => {
      callback(payload);
    };
    ipcRenderer.on('dashboard:updated', handler);
    return () => ipcRenderer.off('dashboard:updated', handler);
  },
  getConfig: () => ipcRenderer.invoke('config:get'),
  onConfigUpdated: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, cfg: AppConfig) => {
      callback(cfg);
    };
    ipcRenderer.on('config:updated', handler);
    return () => ipcRenderer.off('config:updated', handler);
  },
  updateConfig: (patch) => ipcRenderer.invoke('config:update', patch),
  regenerateToken: () => ipcRenderer.invoke('config:regenerate-token'),
  resetSettings: () => ipcRenderer.invoke('config:reset'),
  exportBackup: () => ipcRenderer.invoke('backup:export'),
  importBackup: () => ipcRenderer.invoke('backup:import'),
  triggerCliRescan: () => ipcRenderer.invoke('cli:rescan'),
  setMode: (mode) => ipcRenderer.invoke('window:set-mode', mode),
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke('window:set-pin', enabled),
  hideWindow: () => ipcRenderer.invoke('window:hide'),
  closeCurrentWindow: () => ipcRenderer.invoke('window:close-current'),
  openAnalyticsWindow: () => ipcRenderer.invoke('window:open-analytics'),
  copyText: (text) => ipcRenderer.invoke('clipboard:copy', text),
  updateAccount: (input) => ipcRenderer.invoke('account:update', input),
  reorderAccounts: (orderedIds) => ipcRenderer.invoke('account:reorder', orderedIds),
  manualAdjustBucket: (input) => ipcRenderer.invoke('bucket:manual-adjust', input),
  getAnalytics: (range) => ipcRenderer.invoke('analytics:get', range),
  upsertSubscriptionCost: (sub) => ipcRenderer.invoke('subscription:upsert', sub),
  snoozeSubscription: (provider, days) => ipcRenderer.invoke('subscription:snooze', provider, days),
  sendTestNotification: (kind) => ipcRenderer.invoke('notification:test', kind),
  getUpdateState: () => ipcRenderer.invoke('updater:state'),
  onUpdateStateChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, state: UpdateStateDTO) => {
      callback(state);
    };
    ipcRenderer.on('updater:status', handler);
    return () => ipcRenderer.off('updater:status', handler);
  },
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
};

contextBridge.exposeInMainWorld('quotaApi', api);
