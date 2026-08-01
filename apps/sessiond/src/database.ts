import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  AuthRotateInput,
  DashboardSummary,
  JobInput,
  ScheduledJob,
  ScheduledRun,
  SessionRecord,
  SessionStatus,
  ThinkingLevel,
  UsageSummary
} from "@pi-web/protocol";
import { nowIso, PiWebError } from "@pi-web/shared";

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

type Row = Record<string, unknown>;

function monotonicNullable(
  previous: number | null,
  incoming: number | null
): number | null {
  if (previous === null) return incoming;
  if (incoming === null) return previous;
  return Math.max(previous, incoming);
}

interface CreateSessionRowInput {
  cwd: string;
  displayName: string;
  model?: string | null;
  thinkingLevel?: ThinkingLevel | null;
  systemPrompt?: string | null;
  piSessionReference?: string | null;
  createdBy: "web" | "cron" | "model";
  scheduleRunId?: string | null;
  mutationId?: string;
  mutationFingerprint?: string;
}

export class SessionDatabase {
  readonly db: DatabaseSync;

  constructor(file: string) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    this.db.exec(
      "PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;"
    );
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  migrate(): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec(MIGRATION_1);
      this.db
        .prepare(
          "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, ?)"
        )
        .run(nowIso());
      const migration2 = this.db
        .prepare("SELECT version FROM schema_migrations WHERE version = 2")
        .get();
      if (!migration2) {
        this.db.exec(MIGRATION_2);
        this.db
          .prepare(
            "INSERT INTO schema_migrations(version, applied_at) VALUES (2, ?)"
          )
          .run(nowIso());
      }
      const migration3 = this.db
        .prepare("SELECT version FROM schema_migrations WHERE version = 3")
        .get();
      if (!migration3) {
        this.db.exec(MIGRATION_3);
        this.db
          .prepare(
            "INSERT INTO schema_migrations(version, applied_at) VALUES (3, ?)"
          )
          .run(nowIso());
      }
      const migration4 = this.db
        .prepare("SELECT version FROM schema_migrations WHERE version = 4")
        .get();
      if (!migration4) {
        this.db.exec(MIGRATION_4);
        this.db
          .prepare(
            "INSERT INTO schema_migrations(version, applied_at) VALUES (4, ?)"
          )
          .run(nowIso());
      }
      const migration5 = this.db
        .prepare("SELECT version FROM schema_migrations WHERE version = 5")
        .get();
      if (!migration5) {
        this.db.exec(MIGRATION_5);
        this.db
          .prepare(
            "INSERT INTO schema_migrations(version, applied_at) VALUES (5, ?)"
          )
          .run(nowIso());
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  markOrphanedSessionsInterrupted(): number {
    const now = nowIso();
    const result = this.db
      .prepare(
        `UPDATE sessions
         SET status = 'interrupted', worker_pid = NULL, ended_at = ?,
             interruption_reason = 'sessiond restarted while worker was active',
             updated_at = ?
         WHERE status IN ('starting', 'running', 'waiting', 'stopping')`
      )
      .run(now, now);
    return Number(result.changes);
  }

  markOrphanedRunsFailed(): number {
    const now = nowIso();
    const result = this.db
      .prepare(
        `UPDATE scheduled_runs
         SET status = 'failed', ended_at = ?,
             error_summary = COALESCE(
               error_summary,
               'sessiond restarted while the scheduled run was active'
             )
         WHERE status = 'running'`
      )
      .run(now);
    return Number(result.changes);
  }

  getSetting<T>(key: string): T | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row ? (JSON.parse(row.value) as T) : null;
  }

  setSetting(key: string, value: unknown): void {
    this.db
      .prepare(
        `INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, JSON.stringify(value), nowIso());
  }

  deleteSetting(key: string): void {
    this.db.prepare("DELETE FROM settings WHERE key = ?").run(key);
  }

  rotateAccessKey(input: AuthRotateInput): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.setSetting("access_key_hash", input.hash);
      this.deleteSetting("auth_sessions");
      this.audit(input.auditType, "success", input.actor);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  createSession(input: CreateSessionRowInput): SessionRecord {
    return this.createOrReuseSession(input).session;
  }

  createOrReuseSession(input: CreateSessionRowInput): {
    session: SessionRecord;
    created: boolean;
    mutationCompleted: boolean;
  } {
    if (input.mutationId && !input.mutationFingerprint) {
      throw new PiWebError(
        "MUTATION_FINGERPRINT_REQUIRED",
        "Create mutation fingerprint is required",
        500
      );
    }
    const id = randomUUID();
    const now = nowIso();
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO sessions(
           id, pi_session_reference, cwd, display_name, status, model, thinking_level, system_prompt,
           started_at, last_event_sequence, input_tokens, output_tokens, cached_tokens,
           cost_status, tool_calls, created_by, schedule_run_id, create_mutation_id,
           create_mutation_fingerprint, create_mutation_completed, updated_at
         ) VALUES (?, ?, ?, ?, 'starting', ?, ?, ?, ?, 0, 0, 0, 0, 'unknown', 0, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.piSessionReference ?? null,
        input.cwd,
        input.displayName,
        input.model ?? null,
        input.thinkingLevel ?? null,
        input.systemPrompt ?? null,
        now,
        input.createdBy,
        input.scheduleRunId ?? null,
        input.mutationId ?? null,
        input.mutationFingerprint ?? null,
        input.mutationId ? 0 : 1,
        now
      );
    if (result.changes === 0 && input.mutationId) {
      const existing = this.findCreateMutation(input.mutationId);
      if (existing) {
        assertMutationFingerprint(
          existing.fingerprint,
          input.mutationFingerprint
        );
        return {
          session: existing.session,
          created: false,
          mutationCompleted: existing.completed
        };
      }
    }
    if (result.changes === 0) {
      throw new PiWebError(
        "SESSION_CREATE_FAILED",
        "Session could not be created",
        500
      );
    }
    this.touchDirectory(input.cwd);
    this.audit("session.create", "success", input.createdBy, id, { cwd: input.cwd });
    return {
      session: this.getSession(id),
      created: true,
      mutationCompleted: !input.mutationId
    };
  }

  findCreateMutation(mutationId: string): {
    session: SessionRecord;
    fingerprint: string | null;
    completed: boolean;
  } | null {
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE create_mutation_id = ?")
      .get(mutationId) as Row | undefined;
    return row
      ? {
          session: mapSession(row),
          fingerprint:
            typeof row.create_mutation_fingerprint === "string"
              ? row.create_mutation_fingerprint
              : null,
          completed: Number(row.create_mutation_completed) === 1
        }
      : null;
  }

  completeCreateMutation(id: string, mutationId: string): void {
    const result = this.db
      .prepare(
        `UPDATE sessions
         SET create_mutation_completed = 1, updated_at = ?
         WHERE id = ? AND create_mutation_id = ?`
      )
      .run(nowIso(), id, mutationId);
    if (result.changes === 0) {
      throw new PiWebError(
        "CREATE_MUTATION_NOT_FOUND",
        "Create mutation could not be completed",
        500
      );
    }
  }

  getSession(id: string): SessionRecord {
    const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as
      | Row
      | undefined;
    if (!row) throw new PiWebError("SESSION_NOT_FOUND", "Session not found", 404);
    return mapSession(row);
  }

  listSessions(limit = 100): SessionRecord[] {
    return (
      this.db
        .prepare("SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?")
        .all(Math.max(1, Math.min(limit, 500))) as Row[]
    ).map(mapSession);
  }

  renameSession(
    id: string,
    displayName: string,
    actor = "web"
  ): SessionRecord {
    const updatedAt = nowIso();
    const result = this.db
      .prepare(
        "UPDATE sessions SET display_name = ?, updated_at = ? WHERE id = ?"
      )
      .run(displayName, updatedAt, id);
    if (result.changes === 0) {
      throw new PiWebError("SESSION_NOT_FOUND", "Session not found", 404);
    }
    this.audit("session.rename", "success", actor, id, { displayName });
    return this.getSession(id);
  }

  updateSession(
    id: string,
    patch: Partial<
      Pick<
        SessionRecord,
        | "piSessionReference"
        | "status"
        | "workerPid"
        | "model"
        | "thinkingLevel"
        | "settledAt"
        | "endedAt"
        | "exitCode"
        | "interruptionReason"
        | "lastEventSequence"
        | "inputTokens"
        | "outputTokens"
        | "cachedTokens"
        | "reportedCost"
        | "estimatedCost"
        | "costStatus"
        | "toolCalls"
      >
    >
  ): SessionRecord {
    const current = this.getSession(id);
    const next = { ...current, ...patch, updatedAt: nowIso() };
    this.db
      .prepare(
        `UPDATE sessions SET
          pi_session_reference = ?, status = ?, worker_pid = ?, model = ?,
          thinking_level = ?, settled_at = ?, ended_at = ?, exit_code = ?,
          interruption_reason = ?, last_event_sequence = ?, input_tokens = ?,
          output_tokens = ?, cached_tokens = ?, reported_cost = ?, estimated_cost = ?,
          cost_status = ?, tool_calls = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        next.piSessionReference,
        next.status,
        next.workerPid,
        next.model,
        next.thinkingLevel,
        next.settledAt,
        next.endedAt,
        next.exitCode,
        next.interruptionReason,
        next.lastEventSequence,
        next.inputTokens,
        next.outputTokens,
        next.cachedTokens,
        next.reportedCost,
        next.estimatedCost,
        next.costStatus,
        next.toolCalls,
        next.updatedAt,
        id
      );
    return this.getSession(id);
  }

  updateUsage(id: string, usage: UsageSummary): SessionRecord {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const previous = this.getSession(id);
      const reportedCost = monotonicNullable(
        previous.reportedCost,
        usage.reportedCost
      );
      const estimatedCost = monotonicNullable(
        previous.estimatedCost,
        usage.estimatedCost
      );
      const updated = this.updateSession(id, {
        inputTokens: Math.max(previous.inputTokens, usage.inputTokens),
        outputTokens: Math.max(previous.outputTokens, usage.outputTokens),
        cachedTokens: Math.max(previous.cachedTokens, usage.cachedTokens),
        reportedCost,
        estimatedCost,
        costStatus:
          reportedCost !== null
            ? "reported"
            : estimatedCost !== null
              ? "estimated"
              : "unknown",
        toolCalls: Math.max(previous.toolCalls, usage.toolCalls)
      });
      const day = new Date().toISOString().slice(0, 10);
      this.db
        .prepare(
          `INSERT INTO usage_daily(
             day, input_tokens, output_tokens, cached_tokens, reported_cost, estimated_cost, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(day) DO UPDATE SET
             input_tokens = input_tokens + excluded.input_tokens,
             output_tokens = output_tokens + excluded.output_tokens,
             cached_tokens = cached_tokens + excluded.cached_tokens,
             reported_cost = reported_cost + excluded.reported_cost,
             estimated_cost = estimated_cost + excluded.estimated_cost,
             updated_at = excluded.updated_at`
        )
        .run(
          day,
          updated.inputTokens - previous.inputTokens,
          updated.outputTokens - previous.outputTokens,
          updated.cachedTokens - previous.cachedTokens,
          (updated.reportedCost ?? 0) - (previous.reportedCost ?? 0),
          (updated.estimatedCost ?? 0) - (previous.estimatedCost ?? 0),
          nowIso()
        );
      this.db.exec("COMMIT");
      return updated;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  createJob(
    input: JobInput,
    meta: {
      createdBy: "web" | "model" | "import";
      createdFromSessionId?: string | null;
      nextRunAt: string | null;
    }
  ): ScheduledJob {
    const id = randomUUID();
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO scheduled_jobs(
          id, name, enabled, cron_expression, timezone, cwd, prompt, model,
          thinking_level, timeout_seconds, overlap_policy, created_by,
          created_from_session_id, created_at, updated_at, next_run_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.name,
        input.enabled ? 1 : 0,
        input.cronExpression,
        input.timezone,
        input.cwd,
        input.prompt,
        input.model,
        input.thinkingLevel,
        input.timeoutSeconds,
        input.overlapPolicy,
        meta.createdBy,
        meta.createdFromSessionId ?? null,
        now,
        now,
        meta.nextRunAt
      );
    this.audit("schedule.create", "success", meta.createdBy, id, {
      enabled: input.enabled,
      sourceSessionId: meta.createdFromSessionId ?? null
    });
    return this.getJob(id);
  }

  getJob(id: string): ScheduledJob {
    const row = this.db
      .prepare("SELECT * FROM scheduled_jobs WHERE id = ? AND deleted_at IS NULL")
      .get(id) as Row | undefined;
    if (!row) throw new PiWebError("JOB_NOT_FOUND", "Schedule not found", 404);
    return mapJob(row);
  }

  listJobs(): ScheduledJob[] {
    return (
      this.db
        .prepare("SELECT * FROM scheduled_jobs WHERE deleted_at IS NULL ORDER BY updated_at DESC")
        .all() as Row[]
    ).map(mapJob);
  }

  countJobs(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM scheduled_jobs WHERE deleted_at IS NULL").get() as {
      count: number;
    };
    return Number(row.count);
  }

  updateJob(
    id: string,
    input: JobInput,
    nextRunAt: string | null,
    actor: "web" | "model",
    sourceSessionId?: string
  ): ScheduledJob {
    this.getJob(id);
    this.db
      .prepare(
        `UPDATE scheduled_jobs SET name = ?, enabled = ?, cron_expression = ?,
          timezone = ?, cwd = ?, prompt = ?, model = ?, thinking_level = ?,
          timeout_seconds = ?, overlap_policy = ?, next_run_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        input.name,
        input.enabled ? 1 : 0,
        input.cronExpression,
        input.timezone,
        input.cwd,
        input.prompt,
        input.model,
        input.thinkingLevel,
        input.timeoutSeconds,
        input.overlapPolicy,
        nextRunAt,
        nowIso(),
        id
      );
    this.audit("schedule.update", "success", actor, id, {
      sourceSessionId: sourceSessionId ?? null
    });
    return this.getJob(id);
  }

  setJobEnabled(
    id: string,
    enabled: boolean,
    nextRunAt: string | null,
    actor: "web" | "model",
    sourceSessionId?: string
  ): ScheduledJob {
    this.getJob(id);
    this.db
      .prepare(
        "UPDATE scheduled_jobs SET enabled = ?, next_run_at = ?, updated_at = ? WHERE id = ?"
      )
      .run(enabled ? 1 : 0, nextRunAt, nowIso(), id);
    this.audit(enabled ? "schedule.enable" : "schedule.disable", "success", actor, id, {
      sourceSessionId: sourceSessionId ?? null
    });
    return this.getJob(id);
  }

  updateJobTimes(id: string, lastRunAt: string, nextRunAt: string | null): void {
    this.db
      .prepare(
        "UPDATE scheduled_jobs SET last_run_at = ?, next_run_at = ?, updated_at = ? WHERE id = ?"
      )
      .run(lastRunAt, nextRunAt, nowIso(), id);
  }

  updateJobSchedule(id: string, nextRunAt: string | null): void {
    this.db
      .prepare(
        "UPDATE scheduled_jobs SET next_run_at = ?, updated_at = ? WHERE id = ?"
      )
      .run(nextRunAt, nowIso(), id);
  }

  deleteJob(
    id: string,
    actor: "web" | "model",
    sourceSessionId?: string
  ): void {
    this.getJob(id);
    const now = nowIso();
    this.db
      .prepare(
        "UPDATE scheduled_jobs SET enabled = 0, next_run_at = NULL, deleted_at = ?, updated_at = ? WHERE id = ?"
      )
      .run(now, now, id);
    this.audit("schedule.delete", "success", actor, id, {
      sourceSessionId: sourceSessionId ?? null
    });
  }

  dueJobs(at: string): ScheduledJob[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM scheduled_jobs
           WHERE enabled = 1 AND deleted_at IS NULL AND next_run_at IS NOT NULL AND next_run_at <= ?
           ORDER BY next_run_at ASC`
        )
        .all(at) as Row[]
    ).map(mapJob);
  }

  createRun(input: {
    jobId: string;
    scheduledFor: string;
    triggerType: "cron" | "manual" | "model_run_now";
    status: ScheduledRun["status"];
    sessionId?: string | null;
    errorSummary?: string | null;
  }): ScheduledRun {
    const id = randomUUID();
    const startedAt = input.status === "running" ? nowIso() : null;
    const endedAt = ["skipped_overlap", "failed", "cancelled", "missed"].includes(
      input.status
    )
      ? nowIso()
      : null;
    this.db
      .prepare(
        `INSERT INTO scheduled_runs(
          id, job_id, session_id, scheduled_for, trigger_type, status,
          started_at, ended_at, error_summary
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.jobId,
        input.sessionId ?? null,
        input.scheduledFor,
        input.triggerType,
        input.status,
        startedAt,
        endedAt,
        input.errorSummary ?? null
      );
    return this.getRun(id);
  }

  getRun(id: string): ScheduledRun {
    const row = this.db
      .prepare("SELECT * FROM scheduled_runs WHERE id = ?")
      .get(id) as Row | undefined;
    if (!row) throw new PiWebError("RUN_NOT_FOUND", "Schedule run not found", 404);
    return mapRun(row);
  }

  listRuns(jobId?: string, limit = 100): ScheduledRun[] {
    const rows = jobId
      ? (this.db
          .prepare(
            "SELECT * FROM scheduled_runs WHERE job_id = ? ORDER BY scheduled_for DESC LIMIT ?"
          )
          .all(jobId, limit) as Row[])
      : (this.db
          .prepare("SELECT * FROM scheduled_runs ORDER BY scheduled_for DESC LIMIT ?")
          .all(limit) as Row[]);
    return rows.map(mapRun);
  }

  activeRunForJob(jobId: string): ScheduledRun | null {
    const row = this.db
      .prepare(
        "SELECT * FROM scheduled_runs WHERE job_id = ? AND status = 'running' ORDER BY started_at DESC LIMIT 1"
      )
      .get(jobId) as Row | undefined;
    return row ? mapRun(row) : null;
  }

  updateRun(
    id: string,
    patch: Partial<
      Pick<
        ScheduledRun,
        | "sessionId"
        | "status"
        | "startedAt"
        | "endedAt"
        | "errorSummary"
        | "inputTokens"
        | "outputTokens"
        | "reportedCost"
        | "estimatedCost"
      >
    >
  ): ScheduledRun {
    const current = this.getRun(id);
    const next = { ...current, ...patch };
    this.db
      .prepare(
        `UPDATE scheduled_runs SET session_id = ?, status = ?, started_at = ?,
          ended_at = ?, error_summary = ?, input_tokens = ?, output_tokens = ?,
          reported_cost = ?, estimated_cost = ? WHERE id = ?`
      )
      .run(
        next.sessionId,
        next.status,
        next.startedAt,
        next.endedAt,
        next.errorSummary,
        next.inputTokens,
        next.outputTokens,
        next.reportedCost,
        next.estimatedCost,
        id
      );
    return this.getRun(id);
  }

  touchDirectory(path: string): void {
    this.db
      .prepare(
        `INSERT INTO recent_directories(path, last_used_at) VALUES (?, ?)
         ON CONFLICT(path) DO UPDATE SET last_used_at = excluded.last_used_at`
      )
      .run(path, nowIso());
  }

  listDirectories(): Array<{
    path: string;
    alias: string | null;
    favorite: boolean;
    lastUsedAt: string;
  }> {
    const rows = this.db
      .prepare(
        "SELECT * FROM recent_directories ORDER BY favorite DESC, last_used_at DESC LIMIT 100"
      )
      .all() as Row[];
    return rows.map((row) => ({
      path: String(row.path),
      alias: row.alias === null ? null : String(row.alias),
      favorite: Boolean(row.favorite),
      lastUsedAt: String(row.last_used_at)
    }));
  }

  setDirectoryFavorite(path: string, favorite: boolean, alias?: string | null): void {
    this.db
      .prepare(
        `INSERT INTO recent_directories(path, alias, favorite, last_used_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET alias = excluded.alias,
           favorite = excluded.favorite, last_used_at = excluded.last_used_at`
      )
      .run(path, alias ?? null, favorite ? 1 : 0, nowIso());
  }

  dashboard(): DashboardSummary {
    const day = new Date().toISOString().slice(0, 10);
    const count = (sql: string): number =>
      Number((this.db.prepare(sql).get(day) as { count: number }).count);
    const usage = this.db.prepare("SELECT * FROM usage_daily WHERE day = ?").get(day) as
      | Row
      | undefined;
    return {
      runningSessions: Number(
        (
          this.db
            .prepare(
              "SELECT COUNT(*) AS count FROM sessions WHERE status IN ('starting','running','stopping')"
            )
            .get() as { count: number }
        ).count
      ),
      sessionsToday: count(
        "SELECT COUNT(*) AS count FROM sessions WHERE substr(started_at, 1, 10) = ?"
      ),
      cronRunsToday: count(
        "SELECT COUNT(*) AS count FROM scheduled_runs WHERE substr(scheduled_for, 1, 10) = ?"
      ),
      inputTokensToday: Number(usage?.input_tokens ?? 0),
      outputTokensToday: Number(usage?.output_tokens ?? 0),
      reportedCostToday: Number(usage?.reported_cost ?? 0),
      recentSessions: this.listSessions(8),
      recentRuns: this.listRuns(undefined, 8),
      recentProblems: (
        this.db
          .prepare(
            "SELECT * FROM sessions WHERE status IN ('failed','interrupted') ORDER BY updated_at DESC LIMIT 8"
          )
          .all() as Row[]
      ).map(mapSession)
    };
  }

  audit(
    type: string,
    outcome: "success" | "failure",
    actor: string,
    subjectId?: string | null,
    metadata?: Record<string, unknown>
  ): void {
    this.db
      .prepare(
        `INSERT INTO audit_events(type, outcome, actor, subject_id, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        type,
        outcome,
        actor,
        subjectId ?? null,
        metadata ? JSON.stringify(metadata) : null,
        nowIso()
      );
  }
}

function assertMutationFingerprint(
  existing: string | null,
  incoming: string | undefined
): void {
  if (existing !== null && existing === incoming) return;
  throw new PiWebError(
    "MUTATION_ID_REUSED",
    "Mutation ID was already used for a different payload",
    409
  );
}

function mapSession(row: Row): SessionRecord {
  return {
    id: String(row.id),
    piSessionReference: nullableString(row.pi_session_reference),
    cwd: String(row.cwd),
    displayName: String(row.display_name),
    status: String(row.status) as SessionStatus,
    workerPid: nullableNumber(row.worker_pid),
    model: nullableString(row.model),
    thinkingLevel: nullableString(row.thinking_level) as ThinkingLevel | null,
    systemPrompt: nullableString(row.system_prompt),
    startedAt: String(row.started_at),
    settledAt: nullableString(row.settled_at),
    endedAt: nullableString(row.ended_at),
    exitCode: nullableNumber(row.exit_code),
    interruptionReason: nullableString(row.interruption_reason),
    lastEventSequence: Number(row.last_event_sequence),
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    cachedTokens: Number(row.cached_tokens),
    reportedCost: nullableNumber(row.reported_cost),
    estimatedCost: nullableNumber(row.estimated_cost),
    costStatus: String(row.cost_status) as SessionRecord["costStatus"],
    toolCalls: Number(row.tool_calls),
    createdBy: String(row.created_by) as SessionRecord["createdBy"],
    scheduleRunId: nullableString(row.schedule_run_id),
    updatedAt: String(row.updated_at)
  };
}

function mapJob(row: Row): ScheduledJob {
  return {
    id: String(row.id),
    name: String(row.name),
    enabled: Boolean(row.enabled),
    cronExpression: String(row.cron_expression),
    timezone: String(row.timezone),
    cwd: String(row.cwd),
    prompt: String(row.prompt),
    model: nullableString(row.model),
    thinkingLevel: nullableString(row.thinking_level) as ThinkingLevel | null,
    timeoutSeconds: Number(row.timeout_seconds),
    overlapPolicy: "skip",
    createdBy: String(row.created_by) as ScheduledJob["createdBy"],
    createdFromSessionId: nullableString(row.created_from_session_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastRunAt: nullableString(row.last_run_at),
    nextRunAt: nullableString(row.next_run_at)
  };
}

function mapRun(row: Row): ScheduledRun {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    sessionId: nullableString(row.session_id),
    scheduledFor: String(row.scheduled_for),
    triggerType: String(row.trigger_type) as ScheduledRun["triggerType"],
    status: String(row.status) as ScheduledRun["status"],
    startedAt: nullableString(row.started_at),
    endedAt: nullableString(row.ended_at),
    errorSummary: nullableString(row.error_summary),
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    reportedCost: nullableNumber(row.reported_cost),
    estimatedCost: nullableNumber(row.estimated_cost)
  };
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}
