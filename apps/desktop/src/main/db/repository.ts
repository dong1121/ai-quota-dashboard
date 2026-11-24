import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import initSqlJs, { type Database, type SqlValue } from 'sql.js';
import {
  BUCKET_DEFAULT_LABELS,
  DEFAULT_AGY_CLI_DAILY_LIMIT,
  DEFAULT_CHATGPT_GENERAL_WINDOW_LIMIT,
  DEFAULT_CHATGPT_REASONING_WINDOW_LIMIT,
  DEFAULT_GEMINI_CLI_DAILY_LIMIT,
  DEFAULT_GEMINI_WEB_DAILY_ESTIMATE,
  PROVIDER_META,
  buildDefaultDisplayName,
  computeBucketStatus,
  computeDaysUntilNextBilling,
  computeMonthlyEquivalent,
  evaluateSubscriptionHealth,
  normalizeIdentityKey,
  type AccountBreakdownItem,
  type AccountDTO,
  type AccountUpdateInput,
  type AnalyticsRange,
  type AnalyticsReportDTO,
  type BillingCycle,
  type BucketType,
  type DailySeriesPoint,
  type HeartbeatInput,
  type HourlyBucketPoint,
  type ManualAdjustInput,
  type MeasureMode,
  type ProviderHealthDTO,
  type ProviderType,
  type QuotaBucketDTO,
  type QuotaSnapshotInput,
  type QuotaStatus,
  type SubscriptionCostDTO,
  type UsageEventInput,
} from '@ai-quota/shared';
import { SCHEMA_SQL } from './schema.js';

type ChangeListener = () => void;

export interface BucketWindowConfig {
  geminiCliDailyLimit?: number;
  antigravityCliDailyLimit?: number;
}

const ALL_PROVIDERS: ProviderType[] = ['claude', 'gemini', 'chatgpt'];

export class DatabaseRepository {
  private readonly db: Database;
  private readonly dbPath: string;
  private readonly listeners = new Set<ChangeListener>();
  private persistTimer: NodeJS.Timeout | null = null;
  private dirty = false;

  private constructor(db: Database, dbPath: string) {
    this.db = db;
    this.dbPath = dbPath;
    this.db.run(SCHEMA_SQL);
    this.runMigrations();
  }

  private runMigrations(): void {
    // Safely add Phase 2/3 columns to existing subscription_costs table
    const cols = this.queryAll<{ name: string }>('PRAGMA table_info(subscription_costs)');
    const colNames = new Set(cols.map((c) => c.name));
    const additions: Array<[string, string]> = [
      ['billing_cycle', "TEXT DEFAULT 'monthly'"],
      ['billing_day', 'INTEGER'],
      ['billing_month', 'INTEGER'],
      ['is_paused', 'INTEGER DEFAULT 0'],
      ['snoozed_until', 'TEXT'],
    ];
    for (const [col, def] of additions) {
      if (!colNames.has(col)) {
        this.db.run(`ALTER TABLE subscription_costs ADD COLUMN ${col} ${def}`);
      }
    }
  }

  static async create(dbPath: string): Promise<DatabaseRepository> {
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true });

    const SQL = await initSqlJs();
    let db: Database;
    if (fs.existsSync(dbPath)) {
      const fileBuffer = fs.readFileSync(dbPath);
      db = new SQL.Database(fileBuffer);
    } else {
      db = new SQL.Database();
    }

    const repo = new DatabaseRepository(db, dbPath);
    repo.flush();
    return repo;
  }

  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private markDirty(): void {
    this.dirty = true;
    if (!this.persistTimer) {
      this.persistTimer = setTimeout(() => {
        this.persistTimer = null;
        this.flush();
      }, 250);
    }
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // Ignore subscriber error
      }
    }
  }

  flush(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    const data = this.db.export();
    const tmpPath = `${this.dbPath}.tmp`;
    fs.writeFileSync(tmpPath, Buffer.from(data));
    fs.renameSync(tmpPath, this.dbPath);
    this.dirty = false;
  }

  close(): void {
    if (this.dirty) {
      this.flush();
    }
    this.db.close();
  }

  private queryAll<T extends Record<string, SqlValue>>(
    sql: string,
    params: SqlValue[] = [],
  ): T[] {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const rows: T[] = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as T);
      }
      return rows;
    } finally {
      stmt.free();
    }
  }

  private queryOne<T extends Record<string, SqlValue>>(
    sql: string,
    params: SqlValue[] = [],
  ): T | null {
    const rows = this.queryAll<T>(sql, params);
    return rows[0] ?? null;
  }

  upsertAccount(params: {
    provider: ProviderType;
    identityKey: string;
    profileHint?: string | null;
    displayName?: string;
    colorTag?: string;
  }): string {
    const normalizedKey = normalizeIdentityKey(params.identityKey);
    const nowIso = new Date().toISOString();

    const existing = this.queryOne<{ id: string; profile_hint: string | null }>(
      'SELECT id, profile_hint FROM accounts WHERE provider = ? AND identity_key = ?',
      [params.provider, normalizedKey],
    );

    if (existing) {
      const nextHint = params.profileHint?.trim() || existing.profile_hint;
      this.db.run('UPDATE accounts SET profile_hint = ?, updated_at = ? WHERE id = ?', [
        nextHint,
        nowIso,
        existing.id,
      ]);
      return existing.id;
    }

    const id = crypto.randomUUID();
    const displayName =
      params.displayName?.trim() ||
      buildDefaultDisplayName(params.provider, normalizedKey, params.profileHint);
    const colorTag = params.colorTag?.trim() || PROVIDER_META[params.provider].defaultColor;
    const maxOrder = this.queryOne<{ m: number | null }>('SELECT MAX(sort_order) AS m FROM accounts');
    const nextOrder = (Number(maxOrder?.m ?? -1) || 0) + 1;

    this.db.run(
      `INSERT INTO accounts (id, provider, identity_key, profile_hint, display_name, color_tag, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        params.provider,
        normalizedKey,
        params.profileHint?.trim() ?? null,
        displayName,
        colorTag,
        nextOrder,
        nowIso,
        nowIso,
      ],
    );
    return id;
  }

  updateAccount(input: AccountUpdateInput): boolean {
    const existing = this.queryOne<{ id: string }>('SELECT id FROM accounts WHERE id = ?', [
      input.id,
    ]);
    if (!existing) return false;

    const sets: string[] = [];
    const params: SqlValue[] = [];

    if (typeof input.displayName === 'string' && input.displayName.trim()) {
      sets.push('display_name = ?');
      params.push(input.displayName.trim());
    }
    if (typeof input.colorTag === 'string' && input.colorTag.trim()) {
      sets.push('color_tag = ?');
      params.push(input.colorTag.trim());
    }
    if (typeof input.isHidden === 'boolean') {
      sets.push('is_hidden = ?');
      params.push(input.isHidden ? 1 : 0);
    }
    if (typeof input.notifyEnabled === 'boolean') {
      sets.push('notify_enabled = ?');
      params.push(input.notifyEnabled ? 1 : 0);
    }
    if (typeof input.sortOrder === 'number' && Number.isFinite(input.sortOrder)) {
      sets.push('sort_order = ?');
      params.push(Math.round(input.sortOrder));
    }

    if (sets.length === 0) return true;
    sets.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(input.id);

    this.db.run(`UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`, params);
    this.markDirty();
    return true;
  }

  reorderAccounts(orderedIds: string[]): void {
    const nowIso = new Date().toISOString();
    orderedIds.forEach((id, idx) => {
      this.db.run('UPDATE accounts SET sort_order = ?, updated_at = ? WHERE id = ?', [
        idx,
        nowIso,
        id,
      ]);
    });
    this.markDirty();
  }

  manualAdjustBucket(input: ManualAdjustInput, windowCfg?: BucketWindowConfig): boolean {
    const account = this.queryOne<{ id: string; provider: string; identity_key: string }>(
      'SELECT id, provider, identity_key FROM accounts WHERE id = ?',
      [input.accountId],
    );
    if (!account) return false;

    const nowIso = new Date().toISOString();
    if (input.action === 'increment') {
      this.recordUsageEvent(
        {
          provider: account.provider as ProviderType,
          identityKey: account.identity_key,
          bucketType: input.bucketType,
          measureMode: 'count',
          source: 'manual',
          deltaCount: 1,
          occurredAt: nowIso,
        },
        windowCfg,
      );
      return true;
    }

    const bucket = this.queryOne<{ id: string; measure_mode: string; limit_value: number | null }>(
      'SELECT id, measure_mode, limit_value FROM quota_buckets WHERE account_id = ? AND bucket_type = ?',
      [account.id, input.bucketType],
    );
    if (!bucket) return false;

    if (input.action === 'mark_exhausted') {
      const cooldownMins = input.cooldownMinutes ?? 180;
      const resetAt = new Date(Date.now() + cooldownMins * 60_000).toISOString();
      this.db.run(
        `UPDATE quota_buckets SET status = 'exhausted', reset_at = ?, last_synced_at = ? WHERE id = ?`,
        [resetAt, nowIso, bucket.id],
      );
      this.markDirty();
      return true;
    }

    if (input.action === 'reset_status') {
      this.db.run(
        `UPDATE quota_buckets SET status = 'ok', reset_at = NULL, last_synced_at = ? WHERE id = ?`,
        [nowIso, bucket.id],
      );
      this.markDirty();
      return true;
    }

    return false;
  }

  private ensureBucket(params: {
    accountId: string;
    bucketType: BucketType;
    label?: string;
    measureMode: MeasureMode;
    limitValue?: number | null;
  }): string {
    const existing = this.queryOne<{ id: string }>(
      'SELECT id FROM quota_buckets WHERE account_id = ? AND bucket_type = ?',
      [params.accountId, params.bucketType],
    );
    const nowIso = new Date().toISOString();
    if (existing) {
      if (params.limitValue !== undefined) {
        this.db.run(
          'UPDATE quota_buckets SET limit_value = COALESCE(?, limit_value), last_synced_at = ? WHERE id = ?',
          [params.limitValue, nowIso, existing.id],
        );
      } else {
        this.db.run('UPDATE quota_buckets SET last_synced_at = ? WHERE id = ?', [
          nowIso,
          existing.id,
        ]);
      }
      return existing.id;
    }

    const id = crypto.randomUUID();
    const label = params.label?.trim() || BUCKET_DEFAULT_LABELS[params.bucketType];
    const defaultLimit =
      params.limitValue !== undefined ? params.limitValue : getDefaultBucketLimit(params.bucketType);

    this.db.run(
      `INSERT INTO quota_buckets (id, account_id, bucket_type, label, measure_mode, used_value, limit_value, status, reset_at, last_synced_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, 'ok', NULL, ?)`,
      [id, params.accountId, params.bucketType, label, params.measureMode, defaultLimit, nowIso],
    );
    return id;
  }

  applyHeartbeat(input: HeartbeatInput): string {
    const accountId = this.upsertAccount({
      provider: input.provider,
      identityKey: input.identityKey,
      profileHint: input.profileHint,
      displayName: input.displayName,
      colorTag: input.colorTag,
    });

    if (input.buckets?.length) {
      for (const b of input.buckets) {
        this.ensureBucket({
          accountId,
          bucketType: b.bucketType,
          label: b.label,
          measureMode: b.measureMode,
          limitValue: b.limitValue,
        });
      }
    }

    this.markDirty();
    return accountId;
  }

  applySnapshot(input: QuotaSnapshotInput): string {
    const accountId = this.upsertAccount({
      provider: input.provider,
      identityKey: input.identityKey,
      profileHint: input.profileHint,
      displayName: input.displayName,
    });

    const nowIso = new Date().toISOString();
    for (const b of input.buckets) {
      const bucketId = this.ensureBucket({
        accountId,
        bucketType: b.bucketType,
        label: b.label,
        measureMode: b.measureMode,
        limitValue: b.limitValue,
      });

      const prevBucket = this.queryOne<{ used_value: number; status: string }>(
        'SELECT used_value, status FROM quota_buckets WHERE id = ?',
        [bucketId],
      );

      const limitVal =
        b.limitValue !== undefined ? b.limitValue : b.measureMode === 'percent' ? 100 : null;
      const resetAt = b.resetAt ?? null;
      const status = computeBucketStatus(b.measureMode, b.usedValue, limitVal, resetAt, b.status);

      this.db.run(
        `UPDATE quota_buckets
         SET label = ?, measure_mode = ?, used_value = ?, limit_value = ?, status = ?, reset_at = ?, last_synced_at = ?
         WHERE id = ?`,
        [
          b.label?.trim() || BUCKET_DEFAULT_LABELS[b.bucketType],
          b.measureMode,
          b.usedValue,
          limitVal,
          status,
          resetAt,
          nowIso,
          bucketId,
        ],
      );

      // Persist snapshot history for Claude & percent-based analytics (only when value changes or >60m elapsed)
      const prevSnap = this.queryOne<{ used_value: number; status: string; recorded_at: string }>(
        `SELECT used_value, status, recorded_at FROM quota_snapshots
         WHERE account_id = ? AND bucket_type = ?
         ORDER BY recorded_at DESC LIMIT 1`,
        [accountId, b.bucketType],
      );
      const changed =
        !prevSnap ||
        Math.abs(Number(prevSnap.used_value) - b.usedValue) >= 1 ||
        prevSnap.status !== status ||
        Date.now() - Date.parse(prevSnap.recorded_at) >= 60 * 60_000;

      if (changed) {
        this.db.run(
          `INSERT INTO quota_snapshots (account_id, bucket_type, used_value, status, recorded_at)
           VALUES (?, ?, ?, ?, ?)`,
          [accountId, b.bucketType, b.usedValue, status, nowIso],
        );
      }

      // If Claude 5h utilization stepped UP, also record a usage_event pulse so daily trend charts reflect Claude activity
      if (
        b.bucketType === 'claude_5h' &&
        prevBucket &&
        b.usedValue > Number(prevBucket.used_value)
      ) {
        const deltaStep = Math.max(1, Math.round((b.usedValue - Number(prevBucket.used_value)) / 2));
        this.db.run(
          `INSERT INTO usage_events (account_id, bucket_type, source, model_name, delta_count, tokens_used, occurred_at, external_event_id)
           VALUES (?, ?, 'chrome_ext', 'claude-usage-delta', ?, 0, ?, NULL)`,
          [accountId, b.bucketType, deltaStep, nowIso],
        );
      }
    }

    this.markDirty();
    return accountId;
  }

  recordUsageEvent(
    input: UsageEventInput,
    windowCfg?: BucketWindowConfig,
  ): { inserted: boolean; accountId: string } {
    const accountId = this.upsertAccount({
      provider: input.provider,
      identityKey: input.identityKey,
      profileHint: input.profileHint,
      displayName: input.displayName,
    });

    const measureMode: MeasureMode = input.measureMode ?? 'count';
    const configuredLimit =
      input.limitValue !== undefined
        ? input.limitValue
        : input.bucketType === 'gemini_cli'
          ? (windowCfg?.geminiCliDailyLimit ?? DEFAULT_GEMINI_CLI_DAILY_LIMIT)
          : input.bucketType === 'antigravity_cli'
            ? (windowCfg?.antigravityCliDailyLimit ?? DEFAULT_AGY_CLI_DAILY_LIMIT)
            : getDefaultBucketLimit(input.bucketType);

    const bucketId = this.ensureBucket({
      accountId,
      bucketType: input.bucketType,
      label: input.label,
      measureMode,
      limitValue: configuredLimit,
    });

    const occurredAt = input.occurredAt || new Date().toISOString();
    const deltaCount = input.deltaCount ?? 1;
    const tokensUsed = input.tokensUsed ?? 0;

    let inserted = false;
    if (input.externalEventId) {
      const existingEvent = this.queryOne<{ id: number }>(
        'SELECT id FROM usage_events WHERE external_event_id = ?',
        [input.externalEventId],
      );
      if (!existingEvent) {
        this.db.run(
          `INSERT INTO usage_events (account_id, bucket_type, source, model_name, delta_count, tokens_used, occurred_at, external_event_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            accountId,
            input.bucketType,
            input.source,
            input.modelName ?? null,
            deltaCount,
            tokensUsed,
            occurredAt,
            input.externalEventId,
          ],
        );
        inserted = true;
      }
    } else if (deltaCount > 0 || tokensUsed > 0) {
      this.db.run(
        `INSERT INTO usage_events (account_id, bucket_type, source, model_name, delta_count, tokens_used, occurred_at, external_event_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
        [
          accountId,
          input.bucketType,
          input.source,
          input.modelName ?? null,
          deltaCount,
          tokensUsed,
          occurredAt,
        ],
      );
      inserted = true;
    }

    this.recomputeCountBucket(
      bucketId,
      accountId,
      input.bucketType,
      measureMode,
      configuredLimit,
      input.statusOverride,
      input.resetAt,
    );

    if (inserted || input.statusOverride || input.resetAt) {
      this.markDirty();
    }
    return { inserted, accountId };
  }

  private recomputeCountBucket(
    bucketId: string,
    accountId: string,
    bucketType: BucketType,
    measureMode: MeasureMode,
    limitValue: number | null,
    statusOverride?: QuotaStatus,
    resetAtOverride?: string | null,
  ): void {
    const windowStartIso = getBucketWindowStartIso(bucketType);
    const agg = this.queryOne<{ total_count: number | null }>(
      `SELECT COALESCE(SUM(delta_count), 0) AS total_count
       FROM usage_events
       WHERE account_id = ? AND bucket_type = ? AND occurred_at >= ?`,
      [accountId, bucketType, windowStartIso],
    );

    const existing = this.queryOne<{ status: string; reset_at: string | null }>(
      'SELECT status, reset_at FROM quota_buckets WHERE id = ?',
      [bucketId],
    );

    const usedValue = Number(agg?.total_count ?? 0);
    const nextResetAt =
      resetAtOverride !== undefined ? resetAtOverride : (existing?.reset_at ?? null);
    const explicitStatus =
      statusOverride ??
      (existing?.status === 'exhausted' ? ('exhausted' as QuotaStatus) : undefined);

    const status = computeBucketStatus(measureMode, usedValue, limitValue, nextResetAt, explicitStatus);
    const nowIso = new Date().toISOString();

    this.db.run(
      `UPDATE quota_buckets
       SET used_value = ?, limit_value = ?, status = ?, reset_at = ?, last_synced_at = ?
       WHERE id = ?`,
      [usedValue, limitValue, status, nextResetAt, nowIso, bucketId],
    );
  }

  getAccounts(includeHidden = false): AccountDTO[] {
    const sql = includeHidden
      ? 'SELECT * FROM accounts ORDER BY sort_order ASC, created_at ASC'
      : 'SELECT * FROM accounts WHERE is_hidden = 0 ORDER BY sort_order ASC, created_at ASC';

    const accountRows = this.queryAll<{
      id: string;
      provider: string;
      identity_key: string;
      profile_hint: string | null;
      display_name: string;
      color_tag: string;
      is_hidden: number;
      notify_enabled: number;
      sort_order: number;
      created_at: string;
      updated_at: string;
    }>(sql);

    const bucketRows = this.queryAll<{
      id: string;
      account_id: string;
      bucket_type: string;
      label: string;
      measure_mode: string;
      used_value: number;
      limit_value: number | null;
      status: string;
      reset_at: string | null;
      last_synced_at: string | null;
    }>('SELECT * FROM quota_buckets ORDER BY bucket_type ASC');

    const todayStartIso = getLocalDayStartIso();
    const tokenRows = this.queryAll<{
      account_id: string;
      bucket_type: string;
      tokens_today: number;
    }>(
      `SELECT account_id, bucket_type, COALESCE(SUM(tokens_used), 0) AS tokens_today
       FROM usage_events
       WHERE occurred_at >= ?
       GROUP BY account_id, bucket_type`,
      [todayStartIso],
    );

    const tokenMap = new Map<string, number>();
    for (const row of tokenRows) {
      tokenMap.set(`${row.account_id}:${row.bucket_type}`, Number(row.tokens_today ?? 0));
    }

    const nowMs = Date.now();
    const bucketsByAccount = new Map<string, QuotaBucketDTO[]>();

    for (const row of bucketRows) {
      const bucketType = row.bucket_type as BucketType;
      const measureMode = row.measure_mode as MeasureMode;
      let usedValue = Number(row.used_value ?? 0);
      let resetAt = row.reset_at;
      const explicitStatus = row.status as QuotaStatus;

      if (measureMode === 'count') {
        const winStart = getBucketWindowStartIso(bucketType, nowMs);
        const agg = this.queryOne<{ total_count: number | null }>(
          `SELECT COALESCE(SUM(delta_count), 0) AS total_count
           FROM usage_events
           WHERE account_id = ? AND bucket_type = ? AND occurred_at >= ?`,
          [row.account_id, bucketType, winStart],
        );
        usedValue = Number(agg?.total_count ?? 0);
      }

      const status = computeBucketStatus(
        measureMode,
        usedValue,
        row.limit_value !== null ? Number(row.limit_value) : null,
        resetAt,
        explicitStatus,
        nowMs,
      );

      if (resetAt && Date.parse(resetAt) <= nowMs && measureMode !== 'percent') {
        resetAt = null;
      }

      const dto: QuotaBucketDTO = {
        id: row.id,
        accountId: row.account_id,
        bucketType,
        label: row.label,
        measureMode,
        usedValue,
        limitValue: row.limit_value !== null ? Number(row.limit_value) : null,
        status,
        resetAt,
        lastSyncedAt: row.last_synced_at,
        tokensToday: tokenMap.get(`${row.account_id}:${row.bucket_type}`) ?? 0,
      };

      const list = bucketsByAccount.get(row.account_id) ?? [];
      list.push(dto);
      bucketsByAccount.set(row.account_id, list);
    }

    return accountRows.map((a) => ({
      id: a.id,
      provider: a.provider as ProviderType,
      identityKey: a.identity_key,
      profileHint: a.profile_hint,
      displayName: a.display_name,
      colorTag: a.color_tag,
      isHidden: Boolean(a.is_hidden),
      notifyEnabled: Boolean(a.notify_enabled),
      sortOrder: Number(a.sort_order ?? 0),
      createdAt: a.created_at,
      updatedAt: a.updated_at,
      buckets: sortBuckets(bucketsByAccount.get(a.id) ?? []),
    }));
  }

  getHiddenAccounts(): AccountDTO[] {
    return this.getAccounts(true).filter((a) => a.isHidden);
  }

  getSubscriptionCosts(): Record<ProviderType, SubscriptionCostDTO> {
    const rows = this.queryAll<{
      provider: string;
      monthly_cost: number;
      currency: string;
      billing_cycle: string | null;
      billing_day: number | null;
      billing_month: number | null;
      is_paused: number | null;
      snoozed_until: string | null;
    }>('SELECT * FROM subscription_costs');

    const map = {} as Record<ProviderType, SubscriptionCostDTO>;
    for (const provider of ALL_PROVIDERS) {
      map[provider] = {
        provider,
        billingCycle: 'monthly',
        amount: 0,
        currency: 'TWD',
        billingDay: null,
        billingMonth: null,
        isPaused: false,
        snoozedUntil: null,
      };
    }

    for (const r of rows) {
      const p = r.provider as ProviderType;
      if (!ALL_PROVIDERS.includes(p)) continue;
      map[p] = {
        provider: p,
        billingCycle: r.billing_cycle === 'yearly' ? 'yearly' : 'monthly',
        amount: Number(r.monthly_cost ?? 0),
        currency: r.currency || 'TWD',
        billingDay: r.billing_day !== null ? Number(r.billing_day) : null,
        billingMonth: r.billing_month !== null ? Number(r.billing_month) : null,
        isPaused: Boolean(r.is_paused),
        snoozedUntil: r.snoozed_until ?? null,
      };
    }

    return map;
  }

  upsertSubscriptionCost(sub: SubscriptionCostDTO): SubscriptionCostDTO {
    const cycle: BillingCycle = sub.billingCycle === 'yearly' ? 'yearly' : 'monthly';
    const amount = Number.isFinite(sub.amount) && sub.amount >= 0 ? sub.amount : 0;
    const currency = (sub.currency || 'TWD').trim().toUpperCase();
    const billingDay =
      sub.billingDay && sub.billingDay >= 1 && sub.billingDay <= 31 ? Math.round(sub.billingDay) : null;
    const billingMonth =
      cycle === 'yearly' && sub.billingMonth && sub.billingMonth >= 1 && sub.billingMonth <= 12
        ? Math.round(sub.billingMonth)
        : null;

    this.db.run(
      `INSERT INTO subscription_costs (provider, monthly_cost, currency, billing_cycle, billing_day, billing_month, is_paused, snoozed_until)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider) DO UPDATE SET
         monthly_cost = excluded.monthly_cost,
         currency = excluded.currency,
         billing_cycle = excluded.billing_cycle,
         billing_day = excluded.billing_day,
         billing_month = excluded.billing_month,
         is_paused = excluded.is_paused,
         snoozed_until = excluded.snoozed_until`,
      [
        sub.provider,
        amount,
        currency,
        cycle,
        billingDay,
        billingMonth,
        sub.isPaused ? 1 : 0,
        sub.snoozedUntil ?? null,
      ],
    );
    this.markDirty();
    return this.getSubscriptionCosts()[sub.provider];
  }

  hasNotificationSent(notifKey: string): boolean {
    const row = this.queryOne<{ id: number }>(
      'SELECT id FROM notification_logs WHERE notif_key = ?',
      [notifKey],
    );
    return Boolean(row);
  }

  markNotificationSent(notifKey: string, kind: string): void {
    this.db.run(
      'INSERT OR IGNORE INTO notification_logs (notif_key, kind, sent_at) VALUES (?, ?, ?)',
      [notifKey, kind, new Date().toISOString()],
    );
    this.markDirty();
  }

  getAnalyticsReport(
    range: AnalyticsRange,
    idleDaysThreshold = 14,
    nowDate: Date = new Date(),
  ): AnalyticsReportDTO {
    const { startDate, endDate, prevStartDate, prevEndDate, label, periodDays } =
      resolveDateRange(range, nowDate);
    const startIso = startDate.toISOString();
    const endIso = endDate.toISOString();
    const prevStartIso = prevStartDate.toISOString();
    const prevEndIso = prevEndDate.toISOString();

    const accounts = this.getAccounts(true);
    const accountById = new Map(accounts.map((a) => [a.id, a]));
    const subs = this.getSubscriptionCosts();

    // Fetch all usage events in range
    const events = this.queryAll<{
      account_id: string;
      bucket_type: string;
      delta_count: number;
      tokens_used: number;
      occurred_at: string;
    }>(
      `SELECT account_id, bucket_type, delta_count, tokens_used, occurred_at
       FROM usage_events
       WHERE occurred_at >= ? AND occurred_at < ?`,
      [startIso, endIso],
    );

    const prevAgg = this.queryOne<{ total: number | null }>(
      `SELECT COALESCE(SUM(delta_count), 0) AS total
       FROM usage_events
       WHERE occurred_at >= ? AND occurred_at < ?`,
      [prevStartIso, prevEndIso],
    );
    const previousPeriodInteractions = Number(prevAgg?.total ?? 0);

    // Fetch quota_snapshots in range (for Claude utilization & exhausted stats)
    const snapshots = this.queryAll<{
      account_id: string;
      bucket_type: string;
      used_value: number;
      status: string;
      recorded_at: string;
    }>(
      `SELECT account_id, bucket_type, used_value, status, recorded_at
       FROM quota_snapshots
       WHERE recorded_at >= ? AND recorded_at < ?`,
      [startIso, endIso],
    );

    // Last active timestamp ever per account (for accurate idle days calculation)
    const lastEventRows = this.queryAll<{ account_id: string; last_at: string }>(
      `SELECT account_id, MAX(occurred_at) AS last_at FROM usage_events GROUP BY account_id`,
    );
    const lastSnapRows = this.queryAll<{ account_id: string; last_at: string }>(
      `SELECT account_id, MAX(recorded_at) AS last_at FROM quota_snapshots WHERE used_value > 0 GROUP BY account_id`,
    );
    const lastActiveByAccount = new Map<string, number>();
    for (const r of [...lastEventRows, ...lastSnapRows]) {
      const ms = Date.parse(r.last_at);
      if (!Number.isNaN(ms)) {
        const cur = lastActiveByAccount.get(r.account_id) ?? 0;
        if (ms > cur) lastActiveByAccount.set(r.account_id, ms);
      }
    }

    // Build date-keyed daily series (zero-filled)
    const dailyMap = new Map<string, DailySeriesPoint>();
    const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const lastDay = new Date(endDate.getTime() - 1);
    while (cursor <= lastDay) {
      const key = toLocalDateKey(cursor);
      dailyMap.set(key, {
        date: key,
        claude: 0,
        geminiWeb: 0,
        geminiCli: 0,
        antigravityCli: 0,
        chatgpt: 0,
        total: 0,
      });
      cursor.setDate(cursor.getDate() + 1);
    }

    const hourlyCounts = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
    const globalActiveDays = new Set<string>();

    const providerStats = new Map<
      ProviderType,
      {
        interactions: number;
        tokens: number;
        activeDays: Set<string>;
        weeklyUtils: number[];
        exhaustedCount: number;
        lastActiveMs: number | null;
      }
    >();

    for (const p of ALL_PROVIDERS) {
      providerStats.set(p, {
        interactions: 0,
        tokens: 0,
        activeDays: new Set<string>(),
        weeklyUtils: [],
        exhaustedCount: 0,
        lastActiveMs: null,
      });
    }

    const accountStats = new Map<
      string,
      { interactions: number; tokens: number; activeDays: Set<string> }
    >();

    let totalInteractions = 0;

    for (const ev of events) {
      const acct = accountById.get(ev.account_id);
      if (!acct) continue;

      const count = Number(ev.delta_count ?? 0);
      const tokens = Number(ev.tokens_used ?? 0);
      const dt = new Date(ev.occurred_at);
      if (Number.isNaN(dt.getTime())) continue;

      const dateKey = toLocalDateKey(dt);
      const hour = dt.getHours();

      totalInteractions += count;
      globalActiveDays.add(dateKey);
      hourlyCounts[hour]!.count += count;

      const dayPt = dailyMap.get(dateKey);
      if (dayPt) {
        if (acct.provider === 'claude') dayPt.claude += count;
        else if (ev.bucket_type === 'gemini_cli') dayPt.geminiCli += count;
        else if (ev.bucket_type === 'antigravity_cli') dayPt.antigravityCli += count;
        else if (acct.provider === 'gemini') dayPt.geminiWeb += count;
        else if (acct.provider === 'chatgpt') dayPt.chatgpt += count;
        dayPt.total += count;
      }

      const pStat = providerStats.get(acct.provider)!;
      pStat.interactions += count;
      pStat.tokens += tokens;
      pStat.activeDays.add(dateKey);

      const aStat = accountStats.get(acct.id) ?? {
        interactions: 0,
        tokens: 0,
        activeDays: new Set<string>(),
      };
      aStat.interactions += count;
      aStat.tokens += tokens;
      aStat.activeDays.add(dateKey);
      accountStats.set(acct.id, aStat);
    }

    // Fold Claude / percent snapshots into provider & account activity
    for (const snap of snapshots) {
      const acct = accountById.get(snap.account_id);
      if (!acct) continue;
      const dt = new Date(snap.recorded_at);
      if (Number.isNaN(dt.getTime())) continue;
      const dateKey = toLocalDateKey(dt);
      const val = Number(snap.used_value ?? 0);
      const pStat = providerStats.get(acct.provider)!;

      if (val > 0) {
        pStat.activeDays.add(dateKey);
        globalActiveDays.add(dateKey);
        const aStat = accountStats.get(acct.id) ?? {
          interactions: 0,
          tokens: 0,
          activeDays: new Set<string>(),
        };
        aStat.activeDays.add(dateKey);
        accountStats.set(acct.id, aStat);
      }

      if (snap.bucket_type === 'claude_weekly') {
        pStat.weeklyUtils.push(val);
      }
      if (snap.status === 'exhausted') {
        pStat.exhaustedCount += 1;
      }
    }

    // Aggregate last active per provider
    for (const acct of accounts) {
      const ms = lastActiveByAccount.get(acct.id);
      if (ms) {
        const pStat = providerStats.get(acct.provider)!;
        if (!pStat.lastActiveMs || ms > pStat.lastActiveMs) {
          pStat.lastActiveMs = ms;
        }
      }
    }

    const nowMs = nowDate.getTime();

    const providerHealth: ProviderHealthDTO[] = ALL_PROVIDERS.map((provider) => {
      const pAccounts = accounts.filter((a) => a.provider === provider && !a.isHidden);
      const pStat = providerStats.get(provider)!;
      const sub = subs[provider];
      const monthlyEq = sub.isPaused ? 0 : computeMonthlyEquivalent(sub.amount, sub.billingCycle);
      const daysUntilNextBilling = sub.isPaused
        ? null
        : computeDaysUntilNextBilling(sub.billingCycle, sub.billingDay, sub.billingMonth, nowDate);

      const daysSinceLastActive =
        pStat.lastActiveMs !== null
          ? Math.max(0, Math.floor((nowMs - pStat.lastActiveMs) / 86_400_000))
          : null;

      // For Claude, also check current live bucket weekly utilization if snapshot history is sparse
      let avgWeeklyUtil: number | null = null;
      if (provider === 'claude') {
        if (pStat.weeklyUtils.length > 0) {
          avgWeeklyUtil =
            pStat.weeklyUtils.reduce((a, b) => a + b, 0) / pStat.weeklyUtils.length;
        } else {
          const liveWeekly = pAccounts
            .flatMap((a) => a.buckets)
            .find((b) => b.bucketType === 'claude_weekly');
          if (liveWeekly) avgWeeklyUtil = liveWeekly.usedValue;
        }
      }

      const costPerInteraction =
        monthlyEq > 0 && pStat.interactions > 0
          ? Math.round((monthlyEq / pStat.interactions) * 10) / 10
          : null;

      // Compute how many days we have tracked this provider (prevents false alarms on fresh installs)
      let earliestMs: number | null = null;
      for (const a of pAccounts) {
        const ms = Date.parse(a.createdAt);
        if (!Number.isNaN(ms) && (earliestMs === null || ms < earliestMs)) {
          earliestMs = ms;
        }
      }
      const trackedDays =
        earliestMs !== null
          ? Math.max(1, Math.floor((nowMs - earliestMs) / 86_400_000) + 1)
          : periodDays;

      const evaluated = evaluateSubscriptionHealth({
        provider,
        isPaused: sub.isPaused,
        activeDays: pStat.activeDays.size,
        periodDays,
        trackedDays,
        totalInteractions: pStat.interactions,
        daysSinceLastActive,
        avgWeeklyUtilization: avgWeeklyUtil,
        monthlyEquivalentCost: monthlyEq,
        daysUntilNextBilling,
        idleDaysThreshold,
      });

      return {
        provider,
        accountCount: pAccounts.length,
        activeDays: pStat.activeDays.size,
        totalInteractions: pStat.interactions,
        tokensUsed: pStat.tokens,
        daysSinceLastActive,
        avgWeeklyUtilization: avgWeeklyUtil !== null ? Math.round(avgWeeklyUtil) : null,
        exhaustedCount: pStat.exhaustedCount,
        monthlyEquivalentCost: Math.round(monthlyEq),
        costPerInteraction,
        daysUntilNextBilling,
        grade: evaluated.grade,
        headline: evaluated.headline,
        suggestion: evaluated.suggestion,
        subscription: sub,
      };
    });

    // Build per-account load breakdown (sharePercent relative to same provider!)
    const accountBreakdown: AccountBreakdownItem[] = accounts
      .filter((a) => !a.isHidden)
      .map((a) => {
        const st = accountStats.get(a.id);
        const providerTotal = providerStats.get(a.provider)?.interactions ?? 0;
        const interactions = st?.interactions ?? 0;
        const lastMs = lastActiveByAccount.get(a.id);
        const daysSinceLastActive =
          lastMs !== undefined ? Math.max(0, Math.floor((nowMs - lastMs) / 86_400_000)) : null;

        return {
          accountId: a.id,
          provider: a.provider,
          displayName: a.displayName,
          colorTag: a.colorTag,
          profileHint: a.profileHint,
          interactions,
          tokensUsed: st?.tokens ?? 0,
          activeDays: st?.activeDays.size ?? 0,
          daysSinceLastActive,
          sharePercent: providerTotal > 0 ? Math.round((interactions / providerTotal) * 100) : 0,
        };
      })
      .sort((a, b) => b.interactions - a.interactions);

    const totalMonthlyCost = providerHealth.reduce((sum, p) => sum + p.monthlyEquivalentCost, 0);
    const deltaPercent =
      previousPeriodInteractions > 0
        ? Math.round(((totalInteractions - previousPeriodInteractions) / previousPeriodInteractions) * 100)
        : null;

    return {
      range,
      periodLabel: label,
      periodDays,
      totalInteractions,
      previousPeriodInteractions,
      deltaPercent,
      totalActiveDays: globalActiveDays.size,
      totalMonthlyCost,
      currency: 'TWD',
      providerHealth,
      dailySeries: Array.from(dailyMap.values()),
      accountBreakdown,
      hourlyDistribution: hourlyCounts as HourlyBucketPoint[],
      generatedAt: nowDate.toISOString(),
    };
  }
}

function resolveDateRange(
  range: AnalyticsRange,
  now: Date,
): {
  startDate: Date;
  endDate: Date;
  prevStartDate: Date;
  prevEndDate: Date;
  label: string;
  periodDays: number;
} {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrowStart = new Date(todayStart.getTime() + 86_400_000);

  if (range === '7d') {
    const startDate = new Date(todayStart.getTime() - 6 * 86_400_000);
    const prevStartDate = new Date(startDate.getTime() - 7 * 86_400_000);
    return {
      startDate,
      endDate: tomorrowStart,
      prevStartDate,
      prevEndDate: startDate,
      label: '近 7 天',
      periodDays: 7,
    };
  }

  if (range === 'last_month') {
    const startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endDate = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevStartDate = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const periodDays = Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000);
    return {
      startDate,
      endDate,
      prevStartDate,
      prevEndDate: startDate,
      label: `${startDate.getFullYear()} 年 ${startDate.getMonth() + 1} 月`,
      periodDays,
    };
  }

  if (range === '90d') {
    const startDate = new Date(todayStart.getTime() - 89 * 86_400_000);
    const prevStartDate = new Date(startDate.getTime() - 90 * 86_400_000);
    return {
      startDate,
      endDate: tomorrowStart,
      prevStartDate,
      prevEndDate: startDate,
      label: '近 90 天',
      periodDays: 90,
    };
  }

  // Default: this_month
  const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevStartDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const periodDays = Math.max(1, Math.round((tomorrowStart.getTime() - startDate.getTime()) / 86_400_000));
  return {
    startDate,
    endDate: tomorrowStart,
    prevStartDate,
    prevEndDate: startDate,
    label: `${now.getFullYear()} 年 ${now.getMonth() + 1} 月`,
    periodDays,
  };
}

function toLocalDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getDefaultBucketLimit(bucketType: BucketType): number | null {
  switch (bucketType) {
    case 'claude_5h':
    case 'claude_weekly':
      return 100;
    case 'gemini_cli':
      return DEFAULT_GEMINI_CLI_DAILY_LIMIT;
    case 'antigravity_cli':
      return DEFAULT_AGY_CLI_DAILY_LIMIT;
    case 'gemini_web':
      return DEFAULT_GEMINI_WEB_DAILY_ESTIMATE;
    case 'chatgpt_reasoning':
      return DEFAULT_CHATGPT_REASONING_WINDOW_LIMIT;
    case 'chatgpt_general':
      return DEFAULT_CHATGPT_GENERAL_WINDOW_LIMIT;
    default:
      return null;
  }
}

function getLocalDayStartIso(nowMs: number = Date.now()): string {
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function getBucketWindowStartIso(bucketType: BucketType, nowMs: number = Date.now()): string {
  switch (bucketType) {
    case 'chatgpt_general':
      return new Date(nowMs - 3 * 60 * 60_000).toISOString();
    case 'chatgpt_reasoning':
    case 'chatgpt_deep_research':
      return new Date(nowMs - 7 * 24 * 60 * 60_000).toISOString();
    case 'gemini_web':
    case 'gemini_cli':
    case 'antigravity_cli':
    case 'chatgpt_image':
    default:
      return getLocalDayStartIso(nowMs);
  }
}

const BUCKET_ORDER: Record<BucketType, number> = {
  claude_5h: 1,
  claude_weekly: 2,
  gemini_web: 3,
  gemini_cli: 4,
  antigravity_cli: 5,
  chatgpt_reasoning: 6,
  chatgpt_general: 7,
  chatgpt_deep_research: 8,
  chatgpt_image: 9,
};

function sortBuckets(buckets: QuotaBucketDTO[]): QuotaBucketDTO[] {
  return [...buckets].sort(
    (a, b) => (BUCKET_ORDER[a.bucketType] ?? 99) - (BUCKET_ORDER[b.bucketType] ?? 99),
  );
}
