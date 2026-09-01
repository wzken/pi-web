import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type {
  JobInput,
  ScheduledJob,
  ScheduledRun,
  ThinkingLevel
} from "@pi-web/protocol";
import { nowIso, PiWebError } from "@pi-web/shared";

type Row = Record<string, unknown>;
type AuditWriter = (
  type: string,
  outcome: "success" | "failure",
  actor: string,
  subjectId?: string | null,
  metadata?: Record<string, unknown>
) => void;

export class ScheduleStore {
  constructor(
    readonly db: DatabaseSync,
    private readonly audit: AuditWriter
  ) {}

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

  recordRunNow(
    id: string,
    actor: "web" | "model",
    sourceSessionId?: string
  ): void {
    this.audit("schedule.run_now", "success", actor, id, {
      sourceSessionId: sourceSessionId ?? null
    });
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
            `SELECT * FROM scheduled_runs
             WHERE job_id = ?
             ORDER BY scheduled_for DESC, rowid DESC
             LIMIT ?`
          )
          .all(jobId, limit) as Row[])
      : (this.db
          .prepare(
            `SELECT * FROM scheduled_runs
             ORDER BY scheduled_for DESC, rowid DESC
             LIMIT ?`
          )
          .all(limit) as Row[]);
    return rows.map(mapRun);
  }

  activeRunForJob(jobId: string): ScheduledRun | null {
    const row = this.db
      .prepare(
        `SELECT * FROM scheduled_runs
         WHERE job_id = ? AND status = 'running'
         ORDER BY started_at DESC, rowid DESC
         LIMIT 1`
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
