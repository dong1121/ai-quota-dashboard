import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_AGY_CLI_DAILY_LIMIT,
  DEFAULT_ANALYTICS_OPACITY,
  DEFAULT_FONT_SCALE,
  DEFAULT_GEMINI_CLI_DAILY_LIMIT,
  DEFAULT_LOCAL_PORT,
  DEFAULT_NOTIFICATION_SETTINGS,
  DEFAULT_SHORTCUT,
  DEFAULT_WIDGET_OPACITY,
  MAX_ANALYTICS_OPACITY,
  MAX_FONT_SCALE,
  MAX_WIDGET_OPACITY,
  MIN_ANALYTICS_OPACITY,
  MIN_FONT_SCALE,
  MIN_WIDGET_OPACITY,
  type AppConfig,
} from '@ai-quota/shared';

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const num = Number(value);
  if (Number.isNaN(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generatePairingToken(): string {
  const bytes = crypto.randomBytes(8);
  let raw = '';
  for (let i = 0; i < 8; i++) {
    raw += TOKEN_ALPHABET[bytes[i]! % TOKEN_ALPHABET.length];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}

export function createDefaultConfig(): AppConfig {
  return {
    pairingToken: generatePairingToken(),
    port: DEFAULT_LOCAL_PORT,
    mode: 'widget',
    alwaysOnTop: true,
    shortcut: DEFAULT_SHORTCUT,
    fontScale: DEFAULT_FONT_SCALE,
    widgetOpacity: DEFAULT_WIDGET_OPACITY,
    analyticsFontScale: DEFAULT_FONT_SCALE,
    analyticsOpacity: DEFAULT_ANALYTICS_OPACITY,
    sortMode: 'manual',
    enableGeminiCli: false,
    enableAntigravityCli: true,
    autoCheckUpdates: true,
    notifications: { ...DEFAULT_NOTIFICATION_SETTINGS },
    windowBounds: {
      width: 400,
      height: 560,
    },
    geminiCliDailyLimit: DEFAULT_GEMINI_CLI_DAILY_LIMIT,
    antigravityCliDailyLimit: DEFAULT_AGY_CLI_DAILY_LIMIT,
  };
}

export class ConfigStore {
  private readonly configPath: string;
  private config: AppConfig;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.configPath = path.join(dataDir, 'config.json');
    this.config = this.load();
  }

  private load(): AppConfig {
    const defaults = createDefaultConfig();
    if (!fs.existsSync(this.configPath)) {
      this.saveAtomic(defaults);
      return defaults;
    }
    try {
      const raw = fs.readFileSync(this.configPath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<AppConfig>;
      const merged: AppConfig = {
        ...defaults,
        ...parsed,
        fontScale: clampInt(parsed.fontScale, MIN_FONT_SCALE, MAX_FONT_SCALE, defaults.fontScale),
        widgetOpacity: clampInt(
          parsed.widgetOpacity,
          MIN_WIDGET_OPACITY,
          MAX_WIDGET_OPACITY,
          defaults.widgetOpacity,
        ),
        analyticsFontScale: clampInt(
          parsed.analyticsFontScale,
          MIN_FONT_SCALE,
          MAX_FONT_SCALE,
          defaults.analyticsFontScale,
        ),
        analyticsOpacity: clampInt(
          parsed.analyticsOpacity,
          MIN_ANALYTICS_OPACITY,
          MAX_ANALYTICS_OPACITY,
          defaults.analyticsOpacity,
        ),
        sortMode: parsed.sortMode === 'smart' ? 'smart' : 'manual',
        enableGeminiCli: typeof parsed.enableGeminiCli === 'boolean' ? parsed.enableGeminiCli : false,
        enableAntigravityCli:
          typeof parsed.enableAntigravityCli === 'boolean' ? parsed.enableAntigravityCli : true,
        autoCheckUpdates:
          typeof parsed.autoCheckUpdates === 'boolean' ? parsed.autoCheckUpdates : true,
        notifications: {
          ...defaults.notifications,
          ...(parsed.notifications ?? {}),
        },
        pairingToken:
          typeof parsed.pairingToken === 'string' && parsed.pairingToken.trim().length >= 6
            ? parsed.pairingToken.trim()
            : defaults.pairingToken,
        windowBounds: {
          ...defaults.windowBounds,
          ...(parsed.windowBounds ?? {}),
        },
      };
      return merged;
    } catch {
      this.saveAtomic(defaults);
      return defaults;
    }
  }

  private saveAtomic(next: AppConfig): void {
    const tmpPath = `${this.configPath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(next, null, 2), 'utf-8');
    fs.renameSync(tmpPath, this.configPath);
  }

  get(): AppConfig {
    return {
      ...this.config,
      notifications: { ...this.config.notifications },
      windowBounds: { ...this.config.windowBounds },
    };
  }

  update(patch: Partial<AppConfig>): AppConfig {
    this.config = {
      ...this.config,
      ...patch,
      fontScale:
        patch.fontScale !== undefined
          ? clampInt(patch.fontScale, MIN_FONT_SCALE, MAX_FONT_SCALE, this.config.fontScale)
          : this.config.fontScale,
      widgetOpacity:
        patch.widgetOpacity !== undefined
          ? clampInt(
              patch.widgetOpacity,
              MIN_WIDGET_OPACITY,
              MAX_WIDGET_OPACITY,
              this.config.widgetOpacity,
            )
          : this.config.widgetOpacity,
      analyticsFontScale:
        patch.analyticsFontScale !== undefined
          ? clampInt(
              patch.analyticsFontScale,
              MIN_FONT_SCALE,
              MAX_FONT_SCALE,
              this.config.analyticsFontScale,
            )
          : this.config.analyticsFontScale,
      analyticsOpacity:
        patch.analyticsOpacity !== undefined
          ? clampInt(
              patch.analyticsOpacity,
              MIN_ANALYTICS_OPACITY,
              MAX_ANALYTICS_OPACITY,
              this.config.analyticsOpacity,
            )
          : this.config.analyticsOpacity,
      notifications: {
        ...this.config.notifications,
        ...(patch.notifications ?? {}),
      },
      windowBounds: {
        ...this.config.windowBounds,
        ...(patch.windowBounds ?? {}),
      },
    };
    this.saveAtomic(this.config);
    return this.get();
  }

  regenerateToken(): AppConfig {
    return this.update({ pairingToken: generatePairingToken() });
  }

  resetToDefaultsPreserveToken(): AppConfig {
    const token = this.config.pairingToken;
    const defaults = createDefaultConfig();
    this.config = { ...defaults, pairingToken: token };
    this.saveAtomic(this.config);
    return this.get();
  }
}
