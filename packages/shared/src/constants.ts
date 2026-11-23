import type { BucketType, ProviderType } from './types.js';

export const DEFAULT_LOCAL_PORT = 17321;
export const DEFAULT_LOCAL_HOST = '127.0.0.1';
export const DEFAULT_SHORTCUT = 'Alt+Q';
export const GITHUB_REPO_OWNER = 'dong1121';
export const GITHUB_REPO_NAME = 'ai-quota-dashboard';
export const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases`;
export const DEFAULT_FONT_SCALE = 100;
export const MIN_FONT_SCALE = 85;
export const MAX_FONT_SCALE = 135;
export const DEFAULT_WIDGET_OPACITY = 88;
export const MIN_WIDGET_OPACITY = 55;
export const MAX_WIDGET_OPACITY = 100;
export const DEFAULT_ANALYTICS_OPACITY = 96;
export const MIN_ANALYTICS_OPACITY = 70;
export const MAX_ANALYTICS_OPACITY = 100;
export const PAIRING_HEADER = 'x-pairing-token';
export const APP_DATA_DIR_NAME = 'AIQuotaDashboard';

export const DEFAULT_GEMINI_CLI_DAILY_LIMIT = 1000;
export const DEFAULT_AGY_CLI_DAILY_LIMIT = 500;
export const DEFAULT_GEMINI_WEB_DAILY_ESTIMATE = 50;
export const DEFAULT_CHATGPT_REASONING_WINDOW_LIMIT = 50;
export const DEFAULT_CHATGPT_GENERAL_WINDOW_LIMIT = 80;

export const ACCOUNT_COLOR_PRESETS = [
  { name: '靛藍', hex: '#6366f1' },
  { name: '天空藍', hex: '#3b82f6' },
  { name: '青綠', hex: '#10b981' },
  { name: '紫羅蘭', hex: '#a78bfa' },
  { name: '琥珀橘', hex: '#f59e0b' },
  { name: '玫瑰紅', hex: '#f43f5e' },
  { name: '青藍', hex: '#06b6d4' },
  { name: '石板灰', hex: '#94a3b8' },
] as const;

export const DEFAULT_NOTIFICATION_SETTINGS = {
  enabled: true,
  fullRecoveryEnabled: true,
  lowUsageEnabled: true,
  idleDaysThreshold: 14,
  monthlyRemindDaysBefore: 3,
  yearlyRemindDaysBefore: 7,
  quietHoursEnabled: true,
  quietStartHour: 23,
  quietEndHour: 8,
} as const;

export const PROVIDER_META: Record<
  ProviderType,
  { name: string; defaultColor: string; badgeText: string }
> = {
  claude: {
    name: 'Claude',
    defaultColor: '#a78bfa',
    badgeText: 'Claude',
  },
  gemini: {
    name: 'Gemini',
    defaultColor: '#3b82f6',
    badgeText: 'Gemini',
  },
  chatgpt: {
    name: 'ChatGPT',
    defaultColor: '#10b981',
    badgeText: 'ChatGPT',
  },
};

export const BUCKET_DEFAULT_LABELS: Record<BucketType, string> = {
  claude_5h: '5h 額度',
  claude_weekly: '每週額度',
  gemini_web: '🌐 網頁',
  gemini_cli: '💻 CLI',
  antigravity_cli: '🚀 AGY',
  chatgpt_reasoning: '🧠 推理模型',
  chatgpt_general: '💬 主力對話',
  chatgpt_deep_research: '🔬 深度研究',
  chatgpt_image: '🎨 圖片生成',
};
