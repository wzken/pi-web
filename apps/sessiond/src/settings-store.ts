import { DatabaseSync } from "node:sqlite";
import { nowIso } from "@pi-web/shared";

export class SettingsStore {
  constructor(readonly db: DatabaseSync) {}

  get<T>(key: string): T | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row ? (JSON.parse(row.value) as T) : null;
  }

  set(key: string, value: unknown): void {
    this.db
      .prepare(
        `INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, JSON.stringify(value), nowIso());
  }

  delete(key: string): void {
    this.db.prepare("DELETE FROM settings WHERE key = ?").run(key);
  }
}
