export type ProviderType = 'claude' | 'gemini' | 'chatgpt';

export type BucketType =
  | 'claude_5h'
  | 'claude_weekly'
  | 'gemini_web'
  | 'gemini_cli'
  | 'antigravity_cli'
  | 'chatgpt_reasoning'
  | 'chatgpt_general'
  | 'chatgpt_deep_research'
  | 'chatgpt_image';

export type MeasureMode = 'percent' | 'count' | 'cooldown';

export type QuotaStatus = 'ok' | 'warning' | 'exhausted';

export type EventSource = 'chrome_ext' | 'cli_local' | 'mobile_delta' | 'manual';

export type DisplayMode = 'widget' | 'tray';

export type SortMode = 'manual' | 'smart';

export type BillingCycle = 'monthly' | 'yearly';

export type AnalyticsRange = '7d' | 'this_month' | 'last_month' | '90d';

export type HealthGrade = 'great' | 'low' | 'cancel_candidate' | 'paused' | 'no_data';

export interface NotificationSettings {
  enabled: boolean;
  fullRecoveryEnabled: boolean;
  lowUsageEnabled: boolean;
  idleDaysThreshold: number;
  monthlyRemindDaysBefore: number;
  yearlyRemindDaysBefore: number;
  quietHoursEnabled: boolean;
  quietStartHour: number;
  quietEndHour: number;
}

export interface AccountUpdateInput {
  id: string;
  displayName?: string;
  colorTag?: string;
  isHidden?: boolean;
  notifyEnabled?: boolean;
  sortOrder?: number;
}

export interface ManualAdjustInput {
  accountId: string;
  bucketType: BucketType;
  action: 'increment' | 'mark_exhausted' | 'reset_status';
  cooldownMinutes?: number;
}

export interface SubscriptionCostDTO {
  provider: ProviderType;
  billingCycle: BillingCycle;
  amount: number;
  currency: string;
  billingDay: number | null; // 1-31
  billingMonth: number | null; // 1-12 (used for yearly)
  isPaused: boolean;
  snoozedUntil: string | null;
}

export interface ProviderHealthDTO {
  provider: ProviderType;
  accountCount: number;
  activeDays: number;
  totalInteractions: number;
  tokensUsed: number;
  daysSinceLastActive: number | null;
  avgWeeklyUtilization: number | null; // Especially for Claude percent-based tracking
  exhaustedCount: number;
  monthlyEquivalentCost: number;
  costPerInteraction: number | null;
  daysUntilNextBilling: number | null;
  grade: HealthGrade;
  headline: string;
  suggestion: string;
  subscription: SubscriptionCostDTO;
}

export interface DailySeriesPoint {
  date: string; // YYYY-MM-DD
  claude: number;
  geminiWeb: number;
  geminiCli: number;
  antigravityCli: number;
  chatgpt: number;
  total: number;
}

export interface AccountBreakdownItem {
  accountId: string;
  provider: ProviderType;
  displayName: string;
  colorTag: string;
  profileHint: string | null;
  interactions: number;
  tokensUsed: number;
  activeDays: number;
  daysSinceLastActive: number | null;
  sharePercent: number;
}

export interface HourlyBucketPoint {
  hour: number; // 0-23
  count: number;
}

export interface AnalyticsReportDTO {
  range: AnalyticsRange;
  periodLabel: string;
  periodDays: number;
  totalInteractions: number;
  previousPeriodInteractions: number;
  deltaPercent: number | null;
  totalActiveDays: number;
  totalMonthlyCost: number;
  currency: string;
  providerHealth: ProviderHealthDTO[];
  dailySeries: DailySeriesPoint[];
  accountBreakdown: AccountBreakdownItem[];
  hourlyDistribution: HourlyBucketPoint[];
  generatedAt: string;
}

export interface QuotaBucketDTO {
  id: string;
  accountId: string;
  bucketType: BucketType;
  label: string;
  measureMode: MeasureMode;
  usedValue: number;
  limitValue: number | null;
  status: QuotaStatus;
  resetAt: string | null;
  lastSyncedAt: string | null;
  tokensToday?: number;
}

export interface AccountDTO {
  id: string;
  provider: ProviderType;
  identityKey: string;
  profileHint: string | null;
  displayName: string;
  colorTag: string;
  isHidden: boolean;
  notifyEnabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  buckets: QuotaBucketDTO[];
}

export interface CliWatcherStatus {
  geminiCliFound: boolean;
  geminiCliPath: string;
  geminiCliLastScan: string | null;
  antigravityCliFound: boolean;
  antigravityCliPath: string;
  antigravityCliLastScan: string | null;
}

export interface DashboardPayload {
  accounts: AccountDTO[];
  hiddenAccounts?: AccountDTO[];
  updatedAt: string;
  cliStatus: CliWatcherStatus;
}

export interface HeartbeatInput {
  provider: ProviderType;
  identityKey: string;
  profileHint?: string;
  displayName?: string;
  colorTag?: string;
  buckets?: Array<{
    bucketType: BucketType;
    label?: string;
    measureMode: MeasureMode;
    limitValue?: number | null;
  }>;
}

export interface QuotaSnapshotInput {
  provider: ProviderType;
  identityKey: string;
  profileHint?: string;
  displayName?: string;
  buckets: Array<{
    bucketType: BucketType;
    label?: string;
    measureMode: MeasureMode;
    usedValue: number;
    limitValue?: number | null;
    status?: QuotaStatus;
    resetAt?: string | null;
  }>;
}

export interface UsageEventInput {
  provider: ProviderType;
  identityKey: string;
  profileHint?: string;
  displayName?: string;
  bucketType: BucketType;
  label?: string;
  measureMode?: MeasureMode;
  limitValue?: number | null;
  source: EventSource;
  modelName?: string | null;
  deltaCount?: number;
  tokensUsed?: number;
  occurredAt?: string;
  externalEventId?: string;
  statusOverride?: QuotaStatus;
  resetAt?: string | null;
}

export interface WindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
}

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface UpdateStateDTO {
  status: UpdateStatus;
  currentVersion: string;
  latestVersion?: string;
  releaseNotes?: string;
  downloadPercent?: number;
  releaseUrl?: string;
  message?: string;
  canAutoInstall: boolean;
}

export interface AppConfig {
  pairingToken: string;
  port: number;
  mode: DisplayMode;
  alwaysOnTop: boolean;
  shortcut: string;
  fontScale: number;
  widgetOpacity: number;
  analyticsFontScale: number;
  analyticsOpacity: number;
  sortMode: SortMode;
  enableGeminiCli: boolean;
  enableAntigravityCli: boolean;
  autoCheckUpdates: boolean;
  notifications: NotificationSettings;
  windowBounds: WindowBounds;
  geminiCliDailyLimit: number;
  antigravityCliDailyLimit: number;
}

export interface HealthResponse {
  ok: boolean;
  version: string;
  port: number;
}

export interface PairVerifyResponse {
  ok: boolean;
  version: string;
  serverTime: string;
}
