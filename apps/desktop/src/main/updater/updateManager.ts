import { app, shell } from 'electron';
import {
  GITHUB_RELEASES_URL,
  GITHUB_REPO_NAME,
  GITHUB_REPO_OWNER,
  type UpdateStateDTO,
} from '@ai-quota/shared';

type UpdateListener = (state: UpdateStateDTO) => void;

interface AutoUpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  checkForUpdates: () => Promise<unknown>;
  downloadUpdate: () => Promise<unknown>;
  quitAndInstall: () => void;
}

export class UpdateManager {
  private readonly currentVersion: string;
  private readonly listeners = new Set<UpdateListener>();
  private state: UpdateStateDTO;
  private autoUpdater: AutoUpdaterLike | null = null;
  private readonly isPackaged: boolean;

  constructor(currentVersion: string) {
    this.currentVersion = currentVersion;
    this.isPackaged = Boolean(app?.isPackaged);
    this.state = {
      status: 'idle',
      currentVersion,
      releaseUrl: GITHUB_RELEASES_URL,
      canAutoInstall: this.isPackaged,
    };

    if (this.isPackaged) {
      this.initElectronUpdater();
    }
  }

  private initElectronUpdater(): void {
    try {
      // Load electron-updater dynamically so unpackaged/dev mode stays lightweight
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('electron-updater') as { autoUpdater?: AutoUpdaterLike };
      if (!mod?.autoUpdater) return;
      const updater = mod.autoUpdater;
      updater.autoDownload = false;
      updater.autoInstallOnAppQuit = true;

      updater.on('checking-for-update', () => {
        this.setState({
          status: 'checking',
          message: '正在連線 GitHub 檢查最新版本…',
        });
      });

      updater.on('update-available', (info: unknown) => {
        const rec = (info ?? {}) as { version?: string; releaseNotes?: string };
        this.setState({
          status: 'available',
          latestVersion: rec.version,
          releaseNotes:
            typeof rec.releaseNotes === 'string' ? stripHtml(rec.releaseNotes) : undefined,
          releaseUrl: `${GITHUB_RELEASES_URL}/tag/v${rec.version ?? ''}`,
          message: `發現新版本 v${rec.version ?? ''}！`,
        });
      });

      updater.on('update-not-available', () => {
        this.setState({
          status: 'not-available',
          latestVersion: this.currentVersion,
          message: `目前已是最新版本（v${this.currentVersion}）`,
        });
      });

      updater.on('download-progress', (prog: unknown) => {
        const rec = (prog ?? {}) as { percent?: number };
        const pct = Math.max(0, Math.min(100, Math.round(Number(rec.percent ?? 0))));
        this.setState({
          status: 'downloading',
          downloadPercent: pct,
          message: `正在下載更新檔… ${pct}%`,
        });
      });

      updater.on('update-downloaded', (info: unknown) => {
        const rec = (info ?? {}) as { version?: string };
        this.setState({
          status: 'downloaded',
          latestVersion: rec.version ?? this.state.latestVersion,
          downloadPercent: 100,
          message: '更新檔已下載完成，點擊「立即重啟並更新」即可套用！',
        });
      });

      updater.on('error', (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.setState({
          status: 'error',
          message: `檢查更新失敗：${msg.slice(0, 120)}`,
        });
      });

      this.autoUpdater = updater;
    } catch {
      this.autoUpdater = null;
    }
  }

  onChange(listener: UpdateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): UpdateStateDTO {
    return { ...this.state };
  }

  private setState(patch: Partial<UpdateStateDTO>): UpdateStateDTO {
    this.state = {
      ...this.state,
      ...patch,
      currentVersion: this.currentVersion,
      canAutoInstall: Boolean(this.autoUpdater),
    };
    for (const listener of this.listeners) {
      try {
        listener(this.getState());
      } catch {
        // ignore
      }
    }
    return this.getState();
  }

  async checkForUpdates(): Promise<UpdateStateDTO> {
    if (this.autoUpdater) {
      try {
        await this.autoUpdater.checkForUpdates();
        return this.getState();
      } catch (err) {
        return this.setState({
          status: 'error',
          message: err instanceof Error ? err.message : '無法檢查更新',
        });
      }
    }

    // Fallback for dev mode / portable version: query GitHub Releases API directly
    this.setState({
      status: 'checking',
      message: '正在連線 GitHub 檢查最新版本…',
    });

    try {
      const apiUrl = `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases/latest`;
      const res = await fetch(apiUrl, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `AIQuotaDashboard/${this.currentVersion}`,
        },
      });

      if (res.status === 404) {
        return this.setState({
          status: 'not-available',
          latestVersion: this.currentVersion,
          releaseUrl: GITHUB_RELEASES_URL,
          message: `尚無 GitHub Release 發佈紀錄（目前版本 v${this.currentVersion}）`,
        });
      }

      if (!res.ok) {
        return this.setState({
          status: 'error',
          message: `GitHub API 回傳錯誤 (${res.status})`,
        });
      }

      const data = (await res.json()) as {
        tag_name?: string;
        html_url?: string;
        body?: string;
      };
      const latest = (data.tag_name ?? '').replace(/^v/i, '').trim();
      const releaseUrl = data.html_url || GITHUB_RELEASES_URL;

      if (latest && compareSemver(latest, this.currentVersion) > 0) {
        return this.setState({
          status: 'available',
          latestVersion: latest,
          releaseUrl,
          releaseNotes: data.body?.slice(0, 400),
          message: `發現新版本 v${latest}！可前往 GitHub 下載更新檔。`,
        });
      }

      return this.setState({
        status: 'not-available',
        latestVersion: latest || this.currentVersion,
        releaseUrl,
        message: `目前已是最新版本（v${this.currentVersion}）`,
      });
    } catch {
      return this.setState({
        status: 'error',
        message: '無法連線 GitHub，請檢查網路連線',
      });
    }
  }

  async downloadUpdate(): Promise<UpdateStateDTO> {
    if (this.autoUpdater) {
      try {
        this.setState({ status: 'downloading', downloadPercent: 0, message: '開始下載更新檔…' });
        await this.autoUpdater.downloadUpdate();
        return this.getState();
      } catch (err) {
        return this.setState({
          status: 'error',
          message: err instanceof Error ? err.message : '下載更新失敗',
        });
      }
    }

    await shell.openExternal(this.state.releaseUrl || GITHUB_RELEASES_URL);
    return this.getState();
  }

  quitAndInstall(): void {
    if (this.autoUpdater && this.state.status === 'downloaded') {
      this.autoUpdater.quitAndInstall();
    } else {
      void shell.openExternal(this.state.releaseUrl || GITHUB_RELEASES_URL);
    }
  }
}

export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function stripHtml(raw: string): string {
  return raw.replace(/<[^>]+>/g, '').trim().slice(0, 400);
}
