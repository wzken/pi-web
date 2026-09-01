import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type {
  SessionListPage,
  SessionRecord,
  SessionStatus,
  ThinkingLevel,
  UsageSummary
} from "@pi-web/protocol";
import { nowIso, PiWebError } from "@pi-web/shared";

type Row = Record<string, unknown>;
type Transaction = <T>(operation: () => T) => T;
type AuditWriter = (
  type: string,
  outcome: "success" | "failure",
  actor: string,
  subjectId?: string | null,
  metadata?: Record<string, unknown>
) => void;

function monotonicNullable(
  previous: number | null,
  incoming: number | null
): number | null {
  if (previous === null) return incoming;
  if (incoming === null) return previous;
  return Math.max(previous, incoming);
}

interface SessionListCursor {
  pinned: boolean;
  pinnedAt: string | null;
  updatedAt: string;
  id: string;
}

export interface CreateSessionRowInput {
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

export class SessionStore {
  constructor(
    readonly db: DatabaseSync,
    private readonly transaction: Transaction,
    private readonly touchDirectory: (path: string) => void,
    private readonly audit: AuditWriter
  ) {}

  markOrphansInterrupted(): number {
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

  create(input: CreateSessionRowInput): SessionRecord {
    return this.createOrReuse(input).session;
  }

  createOrReuse(input: CreateSessionRowInput): {
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
      session: this.get(id),
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

  get(id: string): SessionRecord {
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE id = ? AND deleted_at IS NULL")
      .get(id) as
      | Row
      | undefined;
    if (!row) throw new PiWebError("SESSION_NOT_FOUND", "Session not found", 404);
    return mapSession(row);
  }

  list(input: {
    limit?: number;
    cursor?: string | null;
  } = {}): SessionListPage {
    const limit = Math.max(1, Math.min(input.limit ?? 100, 100));
    const cursor = decodeSessionListCursor(input.cursor);
    const rows = this.db
      .prepare(
        `SELECT * FROM sessions
         WHERE deleted_at IS NULL
           AND (
             ? IS NULL
             OR pinned < ?
             OR (pinned = ? AND COALESCE(pinned_at, '') < ?)
             OR (pinned = ? AND COALESCE(pinned_at, '') = ? AND updated_at < ?)
             OR (pinned = ? AND COALESCE(pinned_at, '') = ? AND updated_at = ? AND id < ?)
           )
         ORDER BY pinned DESC, COALESCE(pinned_at, '') DESC, updated_at DESC, id DESC
         LIMIT ?`
      )
      .all(
        cursor ? 1 : null,
        cursor?.pinned ? 1 : 0,
        cursor?.pinned ? 1 : 0,
        cursor?.pinnedAt ?? "",
        cursor?.pinned ? 1 : 0,
        cursor?.pinnedAt ?? "",
        cursor?.updatedAt ?? "",
        cursor?.pinned ? 1 : 0,
        cursor?.pinnedAt ?? "",
        cursor?.updatedAt ?? "",
        cursor?.id ?? "",
        limit + 1
      ) as Row[];
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const last = pageRows.at(-1);
    return {
      sessions: pageRows.map(mapSession),
      nextCursor:
        hasMore && last
          ? encodeSessionListCursor({
              pinned: Number(last.pinned) === 1,
              pinnedAt: nullableString(last.pinned_at),
              updatedAt: String(last.updated_at),
              id: String(last.id)
            })
          : null
    };
  }

  rename(
    id: string,
    displayName: string,
    actor = "web"
  ): SessionRecord {
    return this.transaction(() => {
      const updatedAt = nowIso();
      const result = this.db
        .prepare(
          `UPDATE sessions SET display_name = ?, updated_at = ?
           WHERE id = ? AND deleted_at IS NULL`
        )
        .run(displayName, updatedAt, id);
      if (result.changes === 0) {
        throw new PiWebError("SESSION_NOT_FOUND", "Session not found", 404);
      }
      this.audit("session.rename", "success", actor, id, { displayName });
      return this.get(id);
    });
  }

  setPinned(id: string, pinned: boolean, actor = "web"): SessionRecord {
    return this.transaction(() => {
      const updatedAt = nowIso();
      const result = this.db
        .prepare(
          `UPDATE sessions
           SET pinned = ?, pinned_at = ?, updated_at = ?
           WHERE id = ? AND deleted_at IS NULL`
        )
        .run(pinned ? 1 : 0, pinned ? updatedAt : null, updatedAt, id);
      if (result.changes === 0) {
        throw new PiWebError("SESSION_NOT_FOUND", "Session not found", 404);
      }
      this.audit("session.pin", "success", actor, id, { pinned });
      return this.get(id);
    });
  }

  delete(id: string, actor = "web"): void {
    this.transaction(() => {
      const current = this.db
        .prepare("SELECT id FROM sessions WHERE id = ? AND deleted_at IS NULL")
        .get(id) as { id: string } | undefined;
      if (!current) {
        throw new PiWebError("SESSION_NOT_FOUND", "Session not found", 404);
      }
      this.audit("session.delete", "success", actor, id);
      this.db
        .prepare(
          `UPDATE scheduled_jobs
           SET created_from_session_id = NULL
           WHERE created_from_session_id = ?`
        )
        .run(id);
      this.db
        .prepare("UPDATE scheduled_runs SET session_id = NULL WHERE session_id = ?")
        .run(id);
      this.db
        .prepare("DELETE FROM notifications WHERE session_id = ?")
        .run(id);
      this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
    });
  }

  update(
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
    const current = this.get(id);
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
    return this.get(id);
  }

  updateUsage(id: string, usage: UsageSummary): SessionRecord {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const previous = this.get(id);
      const reportedCost = monotonicNullable(
        previous.reportedCost,
        usage.reportedCost
      );
      const estimatedCost = monotonicNullable(
        previous.estimatedCost,
        usage.estimatedCost
      );
      const updated = this.update(id, {
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

  listProblems(limit = 8): SessionRecord[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM sessions
           WHERE deleted_at IS NULL AND status IN ('failed','interrupted')
           ORDER BY updated_at DESC LIMIT ?`
        )
        .all(limit) as Row[]
    ).map(mapSession);
  }
}

function encodeSessionListCursor(cursor: SessionListCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeSessionListCursor(
  value: string | null | undefined
): SessionListCursor | null {
  if (value === undefined || value === null || value === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new PiWebError(
      "INVALID_SESSION_CURSOR",
      "Session cursor is invalid",
      400
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PiWebError(
      "INVALID_SESSION_CURSOR",
      "Session cursor is invalid",
      400
    );
  }
  const cursor = parsed as Record<string, unknown>;
  if (
    typeof cursor.pinned !== "boolean" ||
    !(cursor.pinnedAt === null || typeof cursor.pinnedAt === "string") ||
    typeof cursor.updatedAt !== "string" ||
    typeof cursor.id !== "string" ||
    cursor.updatedAt.length === 0 ||
    cursor.id.length === 0
  ) {
    throw new PiWebError(
      "INVALID_SESSION_CURSOR",
      "Session cursor is invalid",
      400
    );
  }
  return {
    pinned: cursor.pinned,
    pinnedAt: cursor.pinnedAt,
    updatedAt: cursor.updatedAt,
    id: cursor.id
  };
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
    pinned: Number(row.pinned) === 1,
    pinnedAt: nullableString(row.pinned_at),
    deletedAt: nullableString(row.deleted_at),
    updatedAt: String(row.updated_at)
  };
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}
