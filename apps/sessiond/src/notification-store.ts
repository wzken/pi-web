import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type {
  NotificationRecord,
  NotificationSummary,
  PushDeliveryTarget,
  PushSubscriptionRecord,
  PushVapidKeys
} from "@pi-web/protocol";
import { nowIso, PiWebError } from "@pi-web/shared";

type Row = Record<string, unknown>;
type Transaction = <T>(operation: () => T) => T;

export class NotificationStore {
  constructor(
    readonly db: DatabaseSync,
    private readonly transaction: Transaction
  ) {}

  create(input: {
    dedupeKey: string;
    kind: NotificationRecord["kind"];
    severity: NotificationRecord["severity"];
    title: string;
    body: string;
    href: string;
    sessionId?: string | null;
    jobId?: string | null;
    runId?: string | null;
    requiresAction?: boolean;
  }): { notification: NotificationRecord; created: boolean } {
    return this.transaction(() => {
      const existing = this.db
        .prepare("SELECT * FROM notifications WHERE dedupe_key = ?")
        .get(input.dedupeKey) as Row | undefined;
      if (existing) return { notification: mapNotification(existing), created: false };
      const id = randomUUID();
      const now = nowIso();
      this.db
        .prepare(
          `INSERT INTO notifications(
             id, dedupe_key, kind, severity, title, body, href, session_id,
             job_id, run_id, requires_action, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          input.dedupeKey,
          input.kind,
          input.severity,
          input.title.slice(0, 240),
          input.body.slice(0, 1_000),
          input.href.slice(0, 2_048),
          input.sessionId ?? null,
          input.jobId ?? null,
          input.runId ?? null,
          input.requiresAction === true ? 1 : 0,
          now,
          now
        );
      this.db
        .prepare(
          `INSERT OR IGNORE INTO push_deliveries(notification_id, subscription_id)
           SELECT ?, id FROM push_subscriptions`
        )
        .run(id);
      return { notification: this.get(id), created: true };
    });
  }

  get(id: string): NotificationRecord {
    const row = this.db
      .prepare("SELECT * FROM notifications WHERE id = ?")
      .get(id) as Row | undefined;
    if (!row) {
      throw new PiWebError("NOTIFICATION_NOT_FOUND", "Notification not found", 404);
    }
    return mapNotification(row);
  }

  list(limit = 100): NotificationSummary {
    const boundedLimit = Math.max(1, Math.min(limit, 500));
    const notifications = (
      this.db
        .prepare(
          `SELECT * FROM notifications
           WHERE dismissed_at IS NULL
           ORDER BY created_at DESC, rowid DESC
           LIMIT ?`
        )
        .all(boundedLimit) as Row[]
    ).map(mapNotification);
    const counts = this.db
      .prepare(
        `SELECT
           SUM(CASE WHEN read_at IS NULL AND dismissed_at IS NULL THEN 1 ELSE 0 END) AS unread_count,
           SUM(CASE WHEN requires_action = 1 AND resolved_at IS NULL AND dismissed_at IS NULL THEN 1 ELSE 0 END) AS attention_count
         FROM notifications`
      )
      .get() as Row;
    return {
      notifications,
      unreadCount: Number(counts.unread_count ?? 0),
      attentionCount: Number(counts.attention_count ?? 0)
    };
  }

  markRead(id: string): NotificationRecord {
    const now = nowIso();
    this.transaction(() => {
      this.db
        .prepare(
          `UPDATE notifications SET read_at = COALESCE(read_at, ?), updated_at = ?
           WHERE id = ?`
        )
        .run(now, now, id);
      this.db
        .prepare(
          `DELETE FROM push_deliveries
           WHERE notification_id = ? AND delivered_at IS NULL`
        )
        .run(id);
    });
    return this.get(id);
  }

  markAllRead(): NotificationSummary {
    const now = nowIso();
    this.transaction(() => {
      this.db
        .prepare(
          `UPDATE notifications SET read_at = ?, updated_at = ?
           WHERE read_at IS NULL AND dismissed_at IS NULL`
        )
        .run(now, now);
      this.db
        .prepare(
          `DELETE FROM push_deliveries
           WHERE delivered_at IS NULL AND notification_id IN (
             SELECT id FROM notifications WHERE read_at IS NOT NULL
           )`
        )
        .run();
    });
    return this.list();
  }

  markSessionRead(sessionId: string): NotificationSummary {
    const now = nowIso();
    this.transaction(() => {
      this.db
        .prepare(
          `UPDATE notifications SET read_at = COALESCE(read_at, ?), updated_at = ?
           WHERE session_id = ? AND dismissed_at IS NULL`
        )
        .run(now, now, sessionId);
      this.db
        .prepare(
          `DELETE FROM push_deliveries
           WHERE delivered_at IS NULL AND notification_id IN (
             SELECT id FROM notifications WHERE session_id = ? AND read_at IS NOT NULL
           )`
        )
        .run(sessionId);
    });
    return this.list();
  }

  dismiss(id: string): NotificationRecord {
    const now = nowIso();
    this.transaction(() => {
      this.db
        .prepare(
          `UPDATE notifications SET dismissed_at = COALESCE(dismissed_at, ?),
             read_at = COALESCE(read_at, ?), updated_at = ? WHERE id = ?`
        )
        .run(now, now, now, id);
      this.db
        .prepare("DELETE FROM push_deliveries WHERE notification_id = ?")
        .run(id);
    });
    return this.get(id);
  }

  resolve(dedupeKey: string): NotificationRecord | null {
    const row = this.db
      .prepare("SELECT id FROM notifications WHERE dedupe_key = ?")
      .get(dedupeKey) as { id: string } | undefined;
    if (!row) return null;
    const now = nowIso();
    this.transaction(() => {
      this.db
        .prepare(
          `UPDATE notifications SET resolved_at = COALESCE(resolved_at, ?),
             updated_at = ? WHERE id = ?`
        )
        .run(now, now, row.id);
      this.db
        .prepare(
          `DELETE FROM push_deliveries
           WHERE notification_id = ? AND delivered_at IS NULL`
        )
        .run(row.id);
    });
    return this.get(row.id);
  }

  clearSubscriptions(): void {
    this.db.prepare("DELETE FROM push_subscriptions").run();
  }

  getVapidKeys(): PushVapidKeys | null {
    return this.readVapidKeys();
  }

  setVapidKeys(keys: PushVapidKeys): PushVapidKeys {
    const existing = this.getVapidKeys();
    if (existing) return existing;
    this.writeVapidKeys(keys);
    return keys;
  }

  upsertSubscription(input: {
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent?: string | null;
  }): PushSubscriptionRecord {
    const existing = this.db
      .prepare("SELECT id, created_at FROM push_subscriptions WHERE endpoint = ?")
      .get(input.endpoint) as { id: string; created_at: string } | undefined;
    const id = existing?.id ?? randomUUID();
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO push_subscriptions(
           id, endpoint, p256dh, auth, user_agent, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET
           p256dh = excluded.p256dh,
           auth = excluded.auth,
           user_agent = excluded.user_agent,
           updated_at = excluded.updated_at`
      )
      .run(
        id,
        input.endpoint,
        input.p256dh,
        input.auth,
        input.userAgent ?? null,
        existing?.created_at ?? now,
        now
      );
    return this.getSubscription(input.endpoint);
  }

  getSubscription(endpoint: string): PushSubscriptionRecord {
    const row = this.db
      .prepare("SELECT * FROM push_subscriptions WHERE endpoint = ?")
      .get(endpoint) as Row | undefined;
    if (!row) {
      throw new PiWebError("PUSH_SUBSCRIPTION_NOT_FOUND", "Push subscription not found", 404);
    }
    return mapPushSubscription(row);
  }

  deleteSubscription(endpoint: string): boolean {
    return Number(
      this.db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint).changes
    ) > 0;
  }

  listPendingDeliveries(limit = 100): PushDeliveryTarget[] {
    return (
      this.db
        .prepare(
          `SELECT
             n.*, s.id AS subscription_row_id, s.endpoint, s.p256dh, s.auth,
             s.user_agent, s.created_at AS subscription_created_at,
             s.updated_at AS subscription_updated_at
           FROM push_deliveries d
           JOIN notifications n ON n.id = d.notification_id
           JOIN push_subscriptions s ON s.id = d.subscription_id
           WHERE d.delivered_at IS NULL AND d.attempt_count < 3
             AND n.dismissed_at IS NULL AND n.read_at IS NULL
             AND (n.requires_action = 0 OR n.resolved_at IS NULL)
           ORDER BY n.created_at ASC, n.rowid ASC
           LIMIT ?`
        )
        .all(Math.max(1, Math.min(limit, 500))) as Row[]
    ).map((row) => ({
      notification: mapNotification(row),
      subscription: {
        id: String(row.subscription_row_id),
        endpoint: String(row.endpoint),
        p256dh: String(row.p256dh),
        auth: String(row.auth),
        userAgent: nullableString(row.user_agent),
        createdAt: String(row.subscription_created_at),
        updatedAt: String(row.subscription_updated_at)
      }
    }));
  }

  recordDelivery(
    notificationId: string,
    subscriptionId: string,
    input: { delivered: boolean; errorSummary?: string | null }
  ): void {
    const now = nowIso();
    this.db
      .prepare(
        `UPDATE push_deliveries SET attempt_count = attempt_count + 1,
           last_attempt_at = ?, delivered_at = ?, error_summary = ?
         WHERE notification_id = ? AND subscription_id = ?`
      )
      .run(
        now,
        input.delivered ? now : null,
        input.errorSummary?.slice(0, 1_000) ?? null,
        notificationId,
        subscriptionId
      );
  }

  private readVapidKeys(): PushVapidKeys | null {
    const row = this.db
      .prepare("SELECT value FROM settings WHERE key = 'push_vapid_keys'")
      .get() as { value: string } | undefined;
    return row ? JSON.parse(row.value) as PushVapidKeys : null;
  }

  private writeVapidKeys(keys: PushVapidKeys): void {
    this.db
      .prepare(
        `INSERT INTO settings(key, value, updated_at) VALUES ('push_vapid_keys', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(JSON.stringify(keys), nowIso());
  }
}

function mapNotification(row: Row): NotificationRecord {
  return {
    id: String(row.id),
    kind: String(row.kind) as NotificationRecord["kind"],
    severity: String(row.severity) as NotificationRecord["severity"],
    title: String(row.title),
    body: String(row.body),
    href: String(row.href),
    sessionId: nullableString(row.session_id),
    jobId: nullableString(row.job_id),
    runId: nullableString(row.run_id),
    requiresAction: Number(row.requires_action) === 1,
    readAt: nullableString(row.read_at),
    resolvedAt: nullableString(row.resolved_at),
    dismissedAt: nullableString(row.dismissed_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapPushSubscription(row: Row): PushSubscriptionRecord {
  return {
    id: String(row.id),
    endpoint: String(row.endpoint),
    p256dh: String(row.p256dh),
    auth: String(row.auth),
    userAgent: nullableString(row.user_agent),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}
