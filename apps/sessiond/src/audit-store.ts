import { DatabaseSync } from "node:sqlite";
import { nowIso } from "@pi-web/shared";

export class AuditStore {
  constructor(readonly db: DatabaseSync) {}

  write(
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
