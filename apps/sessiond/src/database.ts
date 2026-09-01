import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AuditStore } from "./audit-store.js";
import { AuthStore } from "./auth-store.js";
import { DashboardReader } from "./dashboard-reader.js";
import { DirectoryStore } from "./directory-store.js";
import { migrateDatabase } from "./migrations.js";
import { NotificationStore } from "./notification-store.js";
import { ScheduleStore } from "./schedule-store.js";
import { SessionStore } from "./session-store.js";
import { SettingsStore } from "./settings-store.js";

export class SessionDatabase {
  readonly db: DatabaseSync;
  readonly audit: AuditStore;
  readonly auth: AuthStore;
  readonly dashboard: DashboardReader;
  readonly directories: DirectoryStore;
  readonly notifications: NotificationStore;
  readonly schedules: ScheduleStore;
  readonly sessions: SessionStore;
  readonly settings: SettingsStore;
  #savepointSequence = 0;

  constructor(file: string) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    this.db.exec(
      "PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;"
    );
    migrateDatabase(this.db);
    this.audit = new AuditStore(this.db);
    this.settings = new SettingsStore(this.db);
    this.directories = new DirectoryStore(this.db);
    this.notifications = new NotificationStore(
      this.db,
      (operation) => this.transaction(operation)
    );
    this.schedules = new ScheduleStore(
      this.db,
      (...args) => this.audit.write(...args)
    );
    this.sessions = new SessionStore(
      this.db,
      (operation) => this.transaction(operation),
      (path) => this.directories.touch(path),
      (...args) => this.audit.write(...args)
    );
    this.auth = new AuthStore(
      (operation) => this.transaction(operation),
      this.settings,
      this.notifications,
      this.audit
    );
    this.dashboard = new DashboardReader(this.db, this.sessions, this.schedules);
  }

  close(): void {
    this.db.close();
  }

  transaction<T>(operation: () => T): T {
    const savepoint = `pi_web_${++this.#savepointSequence}`;
    this.db.exec(`SAVEPOINT ${savepoint}`);
    try {
      const result = operation();
      this.db.exec(`RELEASE ${savepoint}`);
      return result;
    } catch (error) {
      this.db.exec(`ROLLBACK TO ${savepoint}`);
      this.db.exec(`RELEASE ${savepoint}`);
      throw error;
    }
  }
}
