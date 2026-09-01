import { DatabaseSync } from "node:sqlite";
import { nowIso } from "@pi-web/shared";

const MIGRATION_1 = `
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS recent_directories (path TEXT PRIMARY KEY, alias TEXT, favorite INTEGER NOT NULL DEFAULT 0, last_used_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
 id TEXT PRIMARY KEY, pi_session_reference TEXT, cwd TEXT NOT NULL, display_name TEXT NOT NULL,
 status TEXT NOT NULL, worker_pid INTEGER, model TEXT, thinking_level TEXT, started_at TEXT NOT NULL,
 settled_at TEXT, ended_at TEXT, exit_code INTEGER, interruption_reason TEXT,
 last_event_sequence INTEGER NOT NULL DEFAULT 0, input_tokens INTEGER NOT NULL DEFAULT 0,
 output_tokens INTEGER NOT NULL DEFAULT 0, cached_tokens INTEGER NOT NULL DEFAULT 0,
 reported_cost REAL, estimated_cost REAL, cost_status TEXT NOT NULL DEFAULT 'unknown',
 tool_calls INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL, schedule_run_id TEXT, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_status_idx ON sessions(status);
CREATE INDEX IF NOT EXISTS sessions_started_at_idx ON sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS sessions_schedule_run_idx ON sessions(schedule_run_id);
CREATE TABLE IF NOT EXISTS scheduled_jobs (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, enabled INTEGER NOT NULL, cron_expression TEXT NOT NULL,
 timezone TEXT NOT NULL, cwd TEXT NOT NULL, prompt TEXT NOT NULL, model TEXT, thinking_level TEXT,
 timeout_seconds INTEGER NOT NULL, overlap_policy TEXT NOT NULL, created_by TEXT NOT NULL,
 created_from_session_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 last_run_at TEXT, next_run_at TEXT, deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS scheduled_jobs_due_idx ON scheduled_jobs(enabled, next_run_at);
CREATE TABLE IF NOT EXISTS scheduled_runs (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL, session_id TEXT, scheduled_for TEXT NOT NULL,
 trigger_type TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT, ended_at TEXT, error_summary TEXT,
 input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
 reported_cost REAL, estimated_cost REAL,
 FOREIGN KEY(job_id) REFERENCES scheduled_jobs(id) ON DELETE RESTRICT,
 FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS scheduled_runs_job_idx ON scheduled_runs(job_id, scheduled_for DESC);
CREATE INDEX IF NOT EXISTS scheduled_runs_status_idx ON scheduled_runs(status);
CREATE TABLE IF NOT EXISTS usage_daily (
 day TEXT PRIMARY KEY, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
 cached_tokens INTEGER NOT NULL DEFAULT 0, reported_cost REAL NOT NULL DEFAULT 0,
 estimated_cost REAL NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, outcome TEXT NOT NULL,
 actor TEXT NOT NULL, subject_id TEXT, metadata TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_events_created_idx ON audit_events(created_at DESC);
`;

const MIGRATION_2 = `
ALTER TABLE sessions ADD COLUMN system_prompt TEXT;
`;

const MIGRATION_3 = `
ALTER TABLE sessions ADD COLUMN create_mutation_id TEXT;
CREATE UNIQUE INDEX sessions_create_mutation_idx
ON sessions(create_mutation_id)
WHERE create_mutation_id IS NOT NULL;
`;

const MIGRATION_4 = `
ALTER TABLE sessions ADD COLUMN create_mutation_fingerprint TEXT;
`;

const MIGRATION_5 = `
ALTER TABLE sessions ADD COLUMN create_mutation_completed INTEGER NOT NULL DEFAULT 1;
`;

const MIGRATION_6 = `
ALTER TABLE sessions ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN pinned_at TEXT;
ALTER TABLE sessions ADD COLUMN deleted_at TEXT;
CREATE INDEX sessions_visible_order_idx
ON sessions(deleted_at, pinned DESC, pinned_at DESC, updated_at DESC);
`;

const MIGRATION_7 = `
CREATE TABLE notifications (
 id TEXT PRIMARY KEY,
 dedupe_key TEXT NOT NULL UNIQUE,
 kind TEXT NOT NULL,
 severity TEXT NOT NULL,
 title TEXT NOT NULL,
 body TEXT NOT NULL,
 href TEXT NOT NULL,
 session_id TEXT,
 job_id TEXT,
 run_id TEXT,
 requires_action INTEGER NOT NULL DEFAULT 0,
 read_at TEXT,
 resolved_at TEXT,
 dismissed_at TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE SET NULL,
 FOREIGN KEY(job_id) REFERENCES scheduled_jobs(id) ON DELETE SET NULL,
 FOREIGN KEY(run_id) REFERENCES scheduled_runs(id) ON DELETE SET NULL
);
CREATE INDEX notifications_inbox_idx
ON notifications(dismissed_at, created_at DESC);
CREATE INDEX notifications_attention_idx
ON notifications(requires_action, resolved_at, dismissed_at, created_at DESC);
CREATE TABLE push_subscriptions (
 id TEXT PRIMARY KEY,
 endpoint TEXT NOT NULL UNIQUE,
 p256dh TEXT NOT NULL,
 auth TEXT NOT NULL,
 user_agent TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE TABLE push_deliveries (
 notification_id TEXT NOT NULL,
 subscription_id TEXT NOT NULL,
 attempt_count INTEGER NOT NULL DEFAULT 0,
 last_attempt_at TEXT,
 delivered_at TEXT,
 error_summary TEXT,
 PRIMARY KEY(notification_id, subscription_id),
 FOREIGN KEY(notification_id) REFERENCES notifications(id) ON DELETE CASCADE,
 FOREIGN KEY(subscription_id) REFERENCES push_subscriptions(id) ON DELETE CASCADE
);
CREATE INDEX push_deliveries_pending_idx
ON push_deliveries(delivered_at, last_attempt_at, attempt_count);
`;

const incrementalMigrations = [
  MIGRATION_2,
  MIGRATION_3,
  MIGRATION_4,
  MIGRATION_5,
  MIGRATION_6,
  MIGRATION_7
] as const;

export function migrateDatabase(db: DatabaseSync): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(MIGRATION_1);
    const applied = db.prepare(
      "SELECT version FROM schema_migrations WHERE version = ?"
    );
    const record = db.prepare(
      "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)"
    );
    record.run(1, nowIso());
    for (const [index, migration] of incrementalMigrations.entries()) {
      const version = index + 2;
      if (applied.get(version)) continue;
      db.exec(migration);
      record.run(version, nowIso());
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
