import { DatabaseSync } from "node:sqlite";
import type { RecentDirectory } from "@pi-web/protocol";
import { nowIso } from "@pi-web/shared";

type Row = Record<string, unknown>;

export class DirectoryStore {
  constructor(readonly db: DatabaseSync) {}

  touch(path: string): void {
    this.db
      .prepare(
        `INSERT INTO recent_directories(path, last_used_at) VALUES (?, ?)
         ON CONFLICT(path) DO UPDATE SET last_used_at = excluded.last_used_at`
      )
      .run(path, nowIso());
  }

  list(): RecentDirectory[] {
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

  setFavorite(path: string, favorite: boolean, alias?: string | null): void {
    this.db
      .prepare(
        `INSERT INTO recent_directories(path, alias, favorite, last_used_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET alias = excluded.alias,
           favorite = excluded.favorite, last_used_at = excluded.last_used_at`
      )
      .run(path, alias ?? null, favorite ? 1 : 0, nowIso());
  }
}
