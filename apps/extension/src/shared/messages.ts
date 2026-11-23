import type {
  HeartbeatInput,
  ProviderType,
  QuotaSnapshotInput,
  UsageEventInput,
} from '@ai-quota/shared';

export const NET_EVENT_SOURCE = '__AI_QUOTA_NET_HOOK__';

export interface MainWorldNetEvent {
  source: typeof NET_EVENT_SOURCE;
  provider: ProviderType;
  kind: 'prompt' | 'rate_limit' | 'session' | 'claude_usage';
  httpStatus: number;
  url: string;
  modelSlug?: string | null;
  email?: string | null;
  headers?: Record<string, string>;
  body?: unknown;
  timestamp: string;
}

export type ExtensionBgMessage =
  | { type: 'REPORT_HEARTBEAT'; payload: HeartbeatInput }
  | { type: 'REPORT_SNAPSHOT'; payload: QuotaSnapshotInput }
  | { type: 'REPORT_EVENT'; payload: UsageEventInput }
  | { type: 'TRIGGER_CLAUDE_SYNC' }
  | { type: 'SCAN_OPEN_TABS' }
  | { type: 'GET_POPUP_STATE' }
  | { type: 'SAVE_AND_TEST_SETTINGS'; settings: { pairingToken: string; port: number; profileLabel: string } };
