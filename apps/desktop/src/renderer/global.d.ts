import type { QuotaDesktopBridge } from '../preload/index.js';

declare global {
  interface Window {
    quotaApi: QuotaDesktopBridge;
  }
}

export {};
