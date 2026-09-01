import { DatabaseSync } from "node:sqlite";
import type { DashboardSummary } from "@pi-web/protocol";
import { ScheduleStore } from "./schedule-store.js";
import { SessionStore } from "./session-store.js";

type Row = Record<string, unknown>;

export class DashboardReader {
  constructor(
    readonly db: DatabaseSync,
    private readonly sessions: SessionStore,
    private readonly schedules: ScheduleStore
  ) {}

  get(): DashboardSummary {
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
              `SELECT COUNT(*) AS count FROM sessions
               WHERE deleted_at IS NULL
                 AND status IN ('starting','running','stopping')`
            )
            .get() as { count: number }
        ).count
      ),
      sessionsToday: count(
        `SELECT COUNT(*) AS count FROM sessions
         WHERE deleted_at IS NULL AND substr(started_at, 1, 10) = ?`
      ),
      cronRunsToday: count(
        "SELECT COUNT(*) AS count FROM scheduled_runs WHERE substr(scheduled_for, 1, 10) = ?"
      ),
      inputTokensToday: Number(usage?.input_tokens ?? 0),
      outputTokensToday: Number(usage?.output_tokens ?? 0),
      reportedCostToday: Number(usage?.reported_cost ?? 0),
      recentSessions: this.sessions.list({ limit: 8 }).sessions,
      recentRuns: this.schedules.listRuns(undefined, 8),
      recentProblems: this.sessions.listProblems(8)
    };
  }
}
