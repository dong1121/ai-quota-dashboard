export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
    id              TEXT PRIMARY KEY,
    provider        TEXT NOT NULL,
    identity_key    TEXT NOT NULL,
    profile_hint    TEXT,
    display_name    TEXT NOT NULL,
    color_tag       TEXT DEFAULT '#6366f1',
    is_hidden       INTEGER DEFAULT 0,
    notify_enabled  INTEGER DEFAULT 1,
    sort_order      INTEGER DEFAULT 0,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now')),
    UNIQUE(provider, identity_key)
);

CREATE TABLE IF NOT EXISTS quota_buckets (
    id              TEXT PRIMARY KEY,
    account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    bucket_type     TEXT NOT NULL,
    label           TEXT NOT NULL,
    measure_mode    TEXT NOT NULL,
    used_value      REAL DEFAULT 0,
    limit_value     REAL,
    status          TEXT DEFAULT 'ok',
    reset_at        TEXT,
    last_synced_at  TEXT,
    UNIQUE(account_id, bucket_type)
);

CREATE TABLE IF NOT EXISTS usage_events (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id        TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    bucket_type       TEXT NOT NULL,
    source            TEXT NOT NULL,
    model_name        TEXT,
    delta_count       INTEGER DEFAULT 1,
    tokens_used       INTEGER DEFAULT 0,
    occurred_at       TEXT DEFAULT (datetime('now')),
    external_event_id TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_events_external_id
    ON usage_events(external_event_id)
    WHERE external_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_usage_events_lookup
    ON usage_events(account_id, bucket_type, occurred_at);

CREATE TABLE IF NOT EXISTS quota_snapshots (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    bucket_type     TEXT NOT NULL,
    used_value      REAL NOT NULL,
    status          TEXT NOT NULL,
    recorded_at     TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_quota_snapshots_lookup
    ON quota_snapshots(account_id, bucket_type, recorded_at);

CREATE TABLE IF NOT EXISTS subscription_costs (
    provider        TEXT PRIMARY KEY,
    monthly_cost    REAL DEFAULT 0,
    currency        TEXT DEFAULT 'TWD',
    billing_cycle   TEXT DEFAULT 'monthly',
    billing_day     INTEGER,
    billing_month   INTEGER,
    is_paused       INTEGER DEFAULT 0,
    snoozed_until   TEXT
);

CREATE TABLE IF NOT EXISTS notification_logs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    notif_key       TEXT NOT NULL UNIQUE,
    kind            TEXT NOT NULL,
    sent_at         TEXT DEFAULT (datetime('now'))
);
`;
