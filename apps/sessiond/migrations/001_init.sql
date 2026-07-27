PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recent_directories (
  path TEXT PRIMARY KEY,
  alias TEXT,
  favorite INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  pi_session_reference TEXT,
  cwd TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL,
  worker_pid INTEGER,
  model TEXT,
  thinking_level TEXT,
  started_at TEXT NOT NULL,
  settled_at TEXT,
  ended_at TEXT,
  exit_code INTEGER,
  interruption_reason TEXT,
  last_event_sequence INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  reported_cost REAL,
  estimated_cost REAL,
  cost_status TEXT NOT NULL DEFAULT 'unknown',
  tool_calls INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  schedule_run_id TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_status_idx ON sessions(status);
CREATE INDEX IF NOT EXISTS sessions_started_at_idx ON sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS sessions_schedule_run_idx ON sessions(schedule_run_id);

CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  cron_expression TEXT NOT NULL,
  timezone TEXT NOT NULL,
  cwd TEXT NOT NULL,
  prompt TEXT NOT NULL,
  model TEXT,
  thinking_level TEXT,
  timeout_seconds INTEGER NOT NULL,
  overlap_policy TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_from_session_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_run_at TEXT,
  next_run_at TEXT,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS scheduled_jobs_due_idx
  ON scheduled_jobs(enabled, next_run_at);

CREATE TABLE IF NOT EXISTS scheduled_runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  session_id TEXT,
  scheduled_for TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  error_summary TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  reported_cost REAL,
  estimated_cost REAL,
  FOREIGN KEY(job_id) REFERENCES scheduled_jobs(id) ON DELETE RESTRICT,
  FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS scheduled_runs_job_idx
  ON scheduled_runs(job_id, scheduled_for DESC);
CREATE INDEX IF NOT EXISTS scheduled_runs_status_idx
  ON scheduled_runs(status);

CREATE TABLE IF NOT EXISTS usage_daily (
  day TEXT PRIMARY KEY,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  reported_cost REAL NOT NULL DEFAULT 0,
  estimated_cost REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  outcome TEXT NOT NULL,
  actor TEXT NOT NULL,
  subject_id TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_events_created_idx
  ON audit_events(created_at DESC);
