import zlib from 'node:zlib';
import {
  BrowserWindow,
  Menu,
  Tray,
  app,
  globalShortcut,
  nativeImage,
  screen,
} from 'electron';
import path from 'node:path';
import type { AppConfig, DisplayMode } from '@ai-quota/shared';
import type { ConfigStore } from './config.js';

const SNAP_THRESHOLD = 16;

/**
 * Generate a cross-platform RGBA PNG badge in memory (works identically on Windows & macOS Retina).
 */
export function createBadgePngBuffer(size: number): Buffer {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.44;

  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const px = rowStart + 1 + x * 4;

      if (dist <= radius) {
        const t = Math.min(1, Math.max(0, (x + y) / (size * 2)));
        let r = Math.round(99 * (1 - t) + 56 * t);
        let g = Math.round(102 * (1 - t) + 189 * t);
        let b = Math.round(241 * (1 - t) + 248 * t);
        let a = 255;

        if (dist > radius * 0.52 && dist < radius * 0.72 && dy < radius * 0.25) {
          r = 255;
          g = 255;
          b = 255;
          a = 240;
        } else if (dist <= radius * 0.22) {
          r = 255;
          g = 255;
          b = 255;
          a = 255;
        } else if (dist > radius - 1.2) {
          a = Math.max(0, Math.min(255, Math.round(((radius - dist) / 1.2) * 255)));
        }

        raw[px] = r;
        raw[px + 1] = g;
        raw[px + 2] = b;
        raw[px + 3] = a;
      }
    }
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const idat = zlib.deflateSync(raw);

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function createTrayIcon(): Electron.NativeImage {
  const pngSize = process.platform === 'darwin' ? 36 : 32;
  const img = nativeImage.createFromBuffer(createBadgePngBuffer(pngSize), {
    scaleFactor: process.platform === 'darwin' ? 2.0 : 1.0,
  });
  return img;
}

export class WindowManager {
  private win: BrowserWindow | null = null;
  private analyticsWin: BrowserWindow | null = null;
  private tray: Tray | null = null;
  private readonly configStore: ConfigStore;
  private registeredShortcut: string | null = null;
  private lastToggleAt = 0;
  private isQuitting = false;
  private lastPreloadPath: string | null = null;
  private lastRendererTarget: { url?: string; file?: string } | null = null;

  constructor(configStore: ConfigStore) {
    this.configStore = configStore;
  }

  getWindow(): BrowserWindow | null {
    return this.win;
  }

  getAnalyticsWindow(): BrowserWindow | null {
    return this.analyticsWin;
  }

  broadcast(channel: string, payload: unknown): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send(channel, payload);
    }
    if (this.analyticsWin && !this.analyticsWin.isDestroyed()) {
      this.analyticsWin.webContents.send(channel, payload);
    }
  }

  markQuitting(): void {
    this.isQuitting = true;
  }

  createWindow(
    preloadPath: string,
    rendererUrlOrFile: { url?: string; file?: string },
  ): BrowserWindow {
    this.lastPreloadPath = preloadPath;
    this.lastRendererTarget = rendererUrlOrFile;
    const cfg = this.configStore.get();
    const { width, height, x, y } = cfg.windowBounds;

    const win = new BrowserWindow({
      width,
      height,
      x,
      y,
      minWidth: 340,
      minHeight: 300,
      maxWidth: 680,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: true,
      resizable: true,
      alwaysOnTop: cfg.mode === 'tray' ? true : cfg.alwaysOnTop,
      skipTaskbar: cfg.mode === 'tray',
      show: cfg.mode === 'widget',
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    if (process.platform === 'darwin' && cfg.mode === 'tray') {
      app.dock?.hide();
    }

    if (rendererUrlOrFile.url) {
      void win.loadURL(rendererUrlOrFile.url);
    } else if (rendererUrlOrFile.file) {
      void win.loadFile(rendererUrlOrFile.file);
    }

    win.on('moved', () => {
      if (!this.win || this.win.isDestroyed()) return;
      this.snapToWorkAreaEdges();
      const b = this.win.getBounds();
      this.configStore.update({ windowBounds: b });
    });

    win.on('resized', () => {
      if (!this.win || this.win.isDestroyed()) return;
      const b = this.win.getBounds();
      this.configStore.update({ windowBounds: b });
    });

    win.on('blur', () => {
      const current = this.configStore.get();
      if (current.mode === 'tray' && Date.now() - this.lastToggleAt > 200) {
        win.hide();
      }
    });

    win.on('close', (e) => {
      if (!this.isQuitting) {
        e.preventDefault();
        this.setMode('tray');
        win.hide();
      }
    });

    this.win = win;
    this.setupTray();
    this.registerShortcut(cfg.shortcut);
    return win;
  }

  private snapToWorkAreaEdges(): void {
    if (!this.win) return;
    const bounds = this.win.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const area = display.workArea;

    let nextX = bounds.x;
    let nextY = bounds.y;

    if (Math.abs(bounds.x - area.x) <= SNAP_THRESHOLD) {
      nextX = area.x;
    } else if (Math.abs(bounds.x + bounds.width - (area.x + area.width)) <= SNAP_THRESHOLD) {
      nextX = area.x + area.width - bounds.width;
    }

    if (Math.abs(bounds.y - area.y) <= SNAP_THRESHOLD) {
      nextY = area.y;
    } else if (Math.abs(bounds.y + bounds.height - (area.y + area.height)) <= SNAP_THRESHOLD) {
      nextY = area.y + area.height - bounds.height;
    }

    if (nextX !== bounds.x || nextY !== bounds.y) {
      this.win.setPosition(nextX, nextY);
    }
  }

  private setupTray(): void {
    if (this.tray) return;
    const tray = new Tray(createTrayIcon());
    tray.setToolTip('AI 多帳號額度儀表板');

    tray.on('click', () => {
      this.toggleTrayPopup();
    });

    this.tray = tray;
    this.refreshTrayMenu();
  }

  openAnalyticsWindow(): void {
    if (this.analyticsWin && !this.analyticsWin.isDestroyed()) {
      if (this.analyticsWin.isMinimized()) this.analyticsWin.restore();
      this.analyticsWin.show();
      this.analyticsWin.focus();
      return;
    }

    if (!this.lastPreloadPath || !this.lastRendererTarget) return;

    if (process.platform === 'darwin') {
      void app.dock?.show();
    }

    const win = new BrowserWindow({
      width: 960,
      height: 680,
      minWidth: 740,
      minHeight: 520,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: true,
      resizable: true,
      show: true,
      title: 'AI 額度統計與訂閱體檢',
      webPreferences: {
        preload: this.lastPreloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    if (this.lastRendererTarget.url) {
      const base = this.lastRendererTarget.url.replace(/#.*$/, '');
      void win.loadURL(`${base}#analytics`);
    } else if (this.lastRendererTarget.file) {
      void win.loadFile(this.lastRendererTarget.file, { hash: 'analytics' });
    }

    win.on('closed', () => {
      this.analyticsWin = null;
      if (process.platform === 'darwin' && this.configStore.get().mode === 'tray') {
        app.dock?.hide();
      }
    });

    this.analyticsWin = win;
  }

  refreshTrayMenu(): void {
    if (!this.tray) return;
    const cfg = this.configStore.get();
    const menu = Menu.buildFromTemplate([
      {
        label: `顯示 / 隱藏看板 (${cfg.shortcut})`,
        click: () => this.toggleTrayPopup(),
      },
      {
        label: '開啟統計與訂閱體檢視窗',
        click: () => this.openAnalyticsWindow(),
      },
      { type: 'separator' },
      {
        label: cfg.mode === 'widget' ? '切換至系統列常駐模式' : '切換至桌面迷你看板模式',
        click: () => this.setMode(cfg.mode === 'widget' ? 'tray' : 'widget'),
      },
      {
        label: '總是置頂 (Always on Top)',
        type: 'checkbox',
        checked: cfg.alwaysOnTop,
        click: () => this.setAlwaysOnTop(!cfg.alwaysOnTop),
      },
      { type: 'separator' },
      {
        label: '結束程式',
        click: () => {
          this.markQuitting();
          app.quit();
        },
      },
    ]);
    this.tray.setContextMenu(menu);
  }

  toggleTrayPopup(): void {
    if (!this.win) return;
    this.lastToggleAt = Date.now();
    if (this.win.isVisible()) {
      this.win.hide();
      return;
    }

    const cfg = this.configStore.get();
    if (cfg.mode === 'tray') {
      const bounds = this.win.getBounds();

      if (process.platform === 'darwin' && this.tray) {
        // Align right beneath the macOS Menu Bar icon
        const trayBounds = this.tray.getBounds();
        const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
        const area = display.workArea;
        const targetX = Math.max(
          area.x + 8,
          Math.min(
            area.x + area.width - bounds.width - 8,
            Math.round(trayBounds.x + trayBounds.width / 2 - bounds.width / 2),
          ),
        );
        const targetY = Math.max(area.y + 6, trayBounds.y + trayBounds.height + 6);
        this.win.setPosition(targetX, targetY);
      } else {
        // Windows / Linux: align bottom-right above taskbar
        const cursorPoint = screen.getCursorScreenPoint();
        const display = screen.getDisplayNearestPoint(cursorPoint);
        const area = display.workArea;
        const targetX = area.x + area.width - bounds.width - 14;
        const targetY = area.y + area.height - bounds.height - 14;
        this.win.setPosition(targetX, targetY);
      }
    }

    this.win.show();
    this.win.focus();
  }

  setMode(mode: DisplayMode): AppConfig {
    const next = this.configStore.update({ mode });
    if (this.win && !this.win.isDestroyed()) {
      if (mode === 'tray') {
        this.win.setSkipTaskbar(true);
        this.win.setAlwaysOnTop(true, 'floating');
        this.win.hide();
        if (process.platform === 'darwin' && !this.analyticsWin) {
          app.dock?.hide();
        }
      } else {
        this.win.setSkipTaskbar(false);
        this.win.setAlwaysOnTop(next.alwaysOnTop, 'floating');
        if (process.platform === 'darwin') {
          void app.dock?.show();
        }
        this.win.show();
        this.win.focus();
      }
      this.broadcast('config:updated', next);
    }
    this.refreshTrayMenu();
    return next;
  }

  setAlwaysOnTop(alwaysOnTop: boolean): AppConfig {
    const next = this.configStore.update({ alwaysOnTop });
    if (this.win && !this.win.isDestroyed()) {
      this.win.setAlwaysOnTop(next.mode === 'tray' ? true : alwaysOnTop, 'floating');
      this.broadcast('config:updated', next);
    }
    this.refreshTrayMenu();
    return next;
  }

  registerShortcut(shortcut: string): boolean {
    if (this.registeredShortcut) {
      globalShortcut.unregister(this.registeredShortcut);
      this.registeredShortcut = null;
    }

    const cleaned = shortcut.trim();
    if (!cleaned) return false;

    try {
      const ok = globalShortcut.register(cleaned, () => {
        this.toggleTrayPopup();
      });
      if (ok) {
        this.registeredShortcut = cleaned;
        this.refreshTrayMenu();
      }
      return ok;
    } catch {
      return false;
    }
  }

  cleanup(): void {
    globalShortcut.unregisterAll();
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}

export function resolvePreloadPath(): string {
  return path.join(__dirname, 'preload.cjs');
}
