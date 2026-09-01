import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionDatabase } from "./database.js";

describe("SessionDatabase", () => {
  it("persists pinned sessions first and permanently deletes session history", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-web-db-session-actions-"));
    const file = join(directory, "test.sqlite");
    const db = new SessionDatabase(file);
    const older = db.sessions.create({
      cwd: directory,
      displayName: "older pinned",
      createdBy: "web"
    });
    const newer = db.sessions.create({
      cwd: directory,
      displayName: "newer",
      createdBy: "web"
    });

    expect(db.sessions.setPinned(older.id, true)).toMatchObject({ pinned: true });
    expect(db.sessions.list().sessions.map((session) => session.id)).toEqual([
      older.id,
      newer.id
    ]);
    db.sessions.delete(older.id);
    expect(db.sessions.list().sessions.map((session) => session.id)).toEqual([
      newer.id
    ]);
    expect(
      db.db.prepare("SELECT id FROM sessions WHERE id = ?").get(older.id)
    ).toBeUndefined();
    expect(() => db.sessions.get(older.id)).toThrowError(
      expect.objectContaining({ code: "SESSION_NOT_FOUND" })
    );
    db.close();

    const reopened = new SessionDatabase(file);
    expect(
      reopened.sessions.list().sessions.map((session) => session.id)
    ).toEqual([newer.id]);
    reopened.close();
  });

  it("paginates every visible session with stable ordering and no duplicates", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-web-db-session-pages-"));
    const db = new SessionDatabase(join(directory, "test.sqlite"));
    const created = Array.from({ length: 125 }, (_, index) =>
      db.sessions.create({
        cwd: directory,
        displayName: `session-${String(index).padStart(3, "0")}`,
        createdBy: "web"
      })
    );
    const sharedUpdatedAt = "2026-08-12T06:00:00.000Z";
    db.db
      .prepare("UPDATE sessions SET updated_at = ?")
      .run(sharedUpdatedAt);
    db.sessions.setPinned(created[4]!.id, true);
    db.sessions.setPinned(created[119]!.id, true);
    db.db
      .prepare("UPDATE sessions SET pinned_at = ?, updated_at = ? WHERE pinned = 1")
      .run(sharedUpdatedAt, sharedUpdatedAt);

    const collected = [];
    let cursor: string | null = null;
    do {
      const page = db.sessions.list({ limit: 17, cursor });
      collected.push(...page.sessions);
      cursor = page.nextCursor;
    } while (cursor);

    expect(collected).toHaveLength(125);
    expect(new Set(collected.map(({ id }) => id)).size).toBe(125);
    expect(collected.slice(0, 2).every(({ pinned }) => pinned)).toBe(true);
    expect(collected.map(({ id }) => id)).toEqual(
      [...collected]
        .sort((left, right) => right.id.localeCompare(left.id))
        .sort((left, right) => Number(right.pinned) - Number(left.pinned))
        .map(({ id }) => id)
    );
    expect(() => db.sessions.list({ cursor: "not-a-cursor" })).toThrowError(
      expect.objectContaining({ code: "INVALID_SESSION_CURSOR" })
    );
    db.close();
  });

  it("rolls back session actions and surrounding metadata when auditing fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-web-db-session-rollback-"));
    const db = new SessionDatabase(join(directory, "test.sqlite"));
    const session = db.sessions.create({
      cwd: directory,
      displayName: "protected session",
      createdBy: "web"
    });
    db.sessions.setPinned(session.id, true);
    db.settings.set("folder-marker", "before");
    db.db.exec(`
      CREATE TRIGGER reject_session_action_audit
      BEFORE INSERT ON audit_events
      WHEN NEW.type IN ('session.pin', 'session.delete')
      BEGIN
        SELECT RAISE(ABORT, 'audit unavailable');
      END;
    `);

    expect(() => db.sessions.setPinned(session.id, false)).toThrow(
      "audit unavailable"
    );
    expect(db.sessions.get(session.id)).toMatchObject({ pinned: true });

    expect(() =>
      db.transaction(() => {
        db.settings.set("folder-marker", "after");
        db.sessions.delete(session.id);
      })
    ).toThrow("audit unavailable");
    expect(db.settings.get("folder-marker")).toBe("before");
    expect(db.sessions.get(session.id)).toMatchObject({ pinned: true });
    db.close();
  });

  it("durably reuses create mutation IDs and rejects payload changes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-web-db-mutation-"));
    const file = join(directory, "test.sqlite");
    const db = new SessionDatabase(file);
    const first = db.sessions.createOrReuse({
      cwd: directory,
      displayName: "first",
      createdBy: "web",
      mutationId: "mutation-1",
      mutationFingerprint: "fingerprint-1"
    });
    const concurrentRetry = db.sessions.createOrReuse({
      cwd: directory,
      displayName: "first",
      createdBy: "web",
      mutationId: "mutation-1",
      mutationFingerprint: "fingerprint-1"
    });

    expect(first.created).toBe(true);
    expect(first.mutationCompleted).toBe(false);
    expect(concurrentRetry).toMatchObject({
      created: false,
      mutationCompleted: false,
      session: { id: first.session.id }
    });
    expect(() =>
      db.sessions.createOrReuse({
        cwd: directory,
        displayName: "changed",
        createdBy: "web",
        mutationId: "mutation-1",
        mutationFingerprint: "fingerprint-2"
      })
    ).toThrowError(expect.objectContaining({
      code: "MUTATION_ID_REUSED",
      statusCode: 409
    }));
    const distinct = db.sessions.createOrReuse({
      cwd: directory,
      displayName: "second",
      createdBy: "web",
      mutationId: "mutation-2",
      mutationFingerprint: "fingerprint-2"
    });
    expect(distinct.session.id).not.toBe(first.session.id);
    db.close();

    const reopened = new SessionDatabase(file);
    expect(reopened.sessions.findCreateMutation("mutation-1")).toMatchObject({
      session: { id: first.session.id },
      fingerprint: "fingerprint-1",
      completed: false
    });
    reopened.sessions.completeCreateMutation(first.session.id, "mutation-1");
    expect(reopened.sessions.findCreateMutation("mutation-1")?.completed).toBe(true);
    reopened.close();
  });

  it("persists notification inbox state and queues each push subscription once", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-web-db-notifications-"));
    const db = new SessionDatabase(join(directory, "test.sqlite"));
    const session = db.sessions.create({
      cwd: directory,
      displayName: "notification session",
      createdBy: "web"
    });
    const firstSubscription = db.notifications.upsertSubscription({
      endpoint: "https://push.example/one",
      p256dh: "p256dh-one",
      auth: "auth-one",
      userAgent: "test-one"
    });
    const secondSubscription = db.notifications.upsertSubscription({
      endpoint: "https://push.example/two",
      p256dh: "p256dh-two",
      auth: "auth-two",
      userAgent: "test-two"
    });
    const created = db.notifications.create({
      dedupeKey: "session:notification:1",
      kind: "extension_interaction",
      severity: "warning",
      title: "Pi needs your decision",
      body: session.displayName,
      href: `/sessions/${session.id}`,
      sessionId: session.id,
      requiresAction: true
    });
    const duplicate = db.notifications.create({
      dedupeKey: "session:notification:1",
      kind: "extension_interaction",
      severity: "warning",
      title: "duplicate must not replace",
      body: "duplicate",
      href: "/duplicate",
      sessionId: session.id,
      requiresAction: true
    });

    expect(created.created).toBe(true);
    expect(duplicate).toMatchObject({
      created: false,
      notification: { id: created.notification.id, title: "Pi needs your decision" }
    });
    expect(db.notifications.list()).toMatchObject({
      unreadCount: 1,
      attentionCount: 1,
      notifications: [{ id: created.notification.id }]
    });
    expect(
      db.notifications.listPendingDeliveries().map((target) => target.subscription.id).sort()
    ).toEqual([firstSubscription.id, secondSubscription.id].sort());

    db.notifications.recordDelivery(created.notification.id, firstSubscription.id, {
      delivered: true
    });
    expect(
      db.notifications.listPendingDeliveries().map((target) => target.subscription.id)
    ).toEqual([secondSubscription.id]);

    const resolved = db.notifications.resolve("session:notification:1");
    expect(resolved?.resolvedAt).not.toBeNull();
    expect(db.notifications.list().attentionCount).toBe(0);
    expect(db.notifications.listPendingDeliveries()).toEqual([]);

    const next = db.notifications.create({
      dedupeKey: "session:notification:2",
      kind: "session_settled",
      severity: "success",
      title: "done",
      body: session.displayName,
      href: `/sessions/${session.id}`,
      sessionId: session.id
    }).notification;
    expect(db.notifications.list()).toMatchObject({ unreadCount: 2 });
    db.notifications.markSessionRead(session.id);
    expect(db.notifications.list()).toMatchObject({ unreadCount: 0 });
    expect(db.notifications.listPendingDeliveries()).toEqual([]);
    expect(db.notifications.dismiss(next.id).dismissedAt).not.toBeNull();
    expect(db.notifications.list().notifications.map((item) => item.id)).not.toContain(next.id);
    expect(
      db.db.prepare("SELECT version FROM schema_migrations WHERE version = 7").get()
    ).toEqual({ version: 7 });
    db.close();
  });

  it("rotating the access key revokes every push subscription", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-web-db-push-rotate-"));
    const db = new SessionDatabase(join(directory, "test.sqlite"));
    db.notifications.upsertSubscription({
      endpoint: "https://push.example/revoked",
      p256dh: "p256dh",
      auth: "auth"
    });
    db.auth.rotateAccessKey({
      hash: { algorithm: "scrypt", salt: "salt", hash: "hash" },
      auditType: "access_key.reset",
      actor: "web"
    });
    expect(
      db.db.prepare("SELECT COUNT(*) AS count FROM push_subscriptions").get()
    ).toEqual({ count: 0 });
    db.close();
  });

  it("uses WAL, marks orphaned sessions interrupted, and retains run history", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-web-db-"));
    const db = new SessionDatabase(join(directory, "test.sqlite"));
    const journal = db.db.prepare("PRAGMA journal_mode").get() as {
      journal_mode: string;
    };
    expect(journal.journal_mode.toLowerCase()).toBe("wal");
    db.settings.set("temporary", { enabled: true });
    expect(db.settings.get("temporary")).toEqual({ enabled: true });
    db.settings.delete("temporary");
    expect(db.settings.get("temporary")).toBeNull();
    const session = db.sessions.create({
      cwd: directory,
      displayName: "test",
      systemPrompt: "Always run the tests.",
      createdBy: "web"
    });
    expect(db.sessions.get(session.id).systemPrompt).toBe("Always run the tests.");
    const renamed = db.sessions.rename(session.id, "renamed session");
    expect(renamed.displayName).toBe("renamed session");
    expect(renamed.updatedAt >= session.updatedAt).toBe(true);
    expect(db.sessions.markOrphansInterrupted()).toBe(1);
    expect(db.sessions.get(session.id).status).toBe("interrupted");
    const waiting = db.sessions.create({
      cwd: directory,
      displayName: "waiting worker",
      createdBy: "web"
    });
    db.sessions.update(waiting.id, { status: "waiting" });
    expect(db.sessions.markOrphansInterrupted()).toBe(1);
    expect(db.sessions.get(waiting.id).status).toBe("interrupted");
    const job = db.schedules.createJob(
      {
        name: "job",
        enabled: true,
        cronExpression: "0 9 * * *",
        timezone: "UTC",
        cwd: directory,
        prompt: "test",
        model: null,
        thinkingLevel: null,
        timeoutSeconds: 3600,
        overlapPolicy: "skip"
      },
      { createdBy: "web", nextRunAt: new Date(Date.now() + 1000).toISOString() }
    );
    const orphanedRun = db.schedules.createRun({
      jobId: job.id,
      scheduledFor: new Date().toISOString(),
      triggerType: "manual",
      status: "running",
      sessionId: session.id
    });
    expect(db.schedules.markOrphanedRunsFailed()).toBe(1);
    expect(db.schedules.getRun(orphanedRun.id)).toMatchObject({
      status: "failed",
      errorSummary: "sessiond restarted while the scheduled run was active"
    });
    expect(db.schedules.activeRunForJob(job.id)).toBeNull();
    const run = db.schedules.createRun({
      jobId: job.id,
      scheduledFor: new Date().toISOString(),
      triggerType: "manual",
      status: "succeeded",
      sessionId: session.id
    });
    db.schedules.deleteJob(job.id, "web");
    expect(db.schedules.listJobs()).toHaveLength(0);
    expect(db.schedules.listRuns(job.id)[0]?.id).toBe(run.id);
    db.close();
  });

  it("rotates the access key, clears sessions, and audits in one transaction", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-web-db-auth-"));
    const db = new SessionDatabase(join(directory, "test.sqlite"));
    const hash = {
      algorithm: "scrypt" as const,
      salt: "new-salt",
      hash: "new-hash"
    };
    db.settings.set("auth_sessions", [{ id: "old-session" }]);

    db.auth.rotateAccessKey({
      hash,
      auditType: "access_key.reset",
      actor: "web"
    });

    expect(db.settings.get("access_key_hash")).toEqual(hash);
    expect(db.settings.get("auth_sessions")).toBeNull();
    expect(
      db.db
        .prepare(
          "SELECT type, outcome, actor FROM audit_events ORDER BY id DESC LIMIT 1"
        )
        .get()
    ).toEqual({
      type: "access_key.reset",
      outcome: "success",
      actor: "web"
    });
    db.close();
  });

  it("keeps usage monotonic and commits session and daily totals atomically", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-web-db-usage-"));
    const db = new SessionDatabase(join(directory, "test.sqlite"));
    const session = db.sessions.create({
      cwd: directory,
      displayName: "usage",
      createdBy: "web"
    });
    const usage = (inputTokens: number) => ({
      inputTokens,
      outputTokens: inputTokens / 2,
      cachedTokens: inputTokens / 4,
      reportedCost: inputTokens / 1000,
      estimatedCost: null,
      costStatus: "reported" as const,
      toolCalls: inputTokens / 10
    });

    db.sessions.updateUsage(session.id, usage(100));
    db.sessions.updateUsage(session.id, usage(80));
    db.sessions.updateUsage(session.id, usage(120));

    expect(db.sessions.get(session.id)).toMatchObject(usage(120));
    expect(
      db.db
        .prepare(
          "SELECT input_tokens, output_tokens, cached_tokens, reported_cost, estimated_cost FROM usage_daily"
        )
        .get()
    ).toEqual({
      input_tokens: 120,
      output_tokens: 60,
      cached_tokens: 30,
      reported_cost: 0.12,
      estimated_cost: 0
    });

    db.db.exec(`
      CREATE TRIGGER fail_usage_daily
      BEFORE UPDATE ON usage_daily
      BEGIN
        SELECT RAISE(ABORT, 'daily usage failed');
      END;
    `);
    expect(() => db.sessions.updateUsage(session.id, usage(140))).toThrow(
      "daily usage failed"
    );
    expect(db.sessions.get(session.id)).toMatchObject(usage(120));
    db.close();
  });

  it("rolls back the key and session changes when rotation auditing fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-web-db-auth-rollback-"));
    const db = new SessionDatabase(join(directory, "test.sqlite"));
    const oldHash = {
      algorithm: "scrypt" as const,
      salt: "old-salt",
      hash: "old-hash"
    };
    const sessions = [{ id: "still-valid-until-rotation-commits" }];
    db.settings.set("access_key_hash", oldHash);
    db.settings.set("auth_sessions", sessions);
    db.db.exec(`
      CREATE TRIGGER fail_access_key_audit
      BEFORE INSERT ON audit_events
      WHEN NEW.type = 'access_key.reset'
      BEGIN
        SELECT RAISE(ABORT, 'audit failed');
      END;
    `);

    expect(() =>
      db.auth.rotateAccessKey({
        hash: {
          algorithm: "scrypt",
          salt: "new-salt",
          hash: "new-hash"
        },
        auditType: "access_key.reset",
        actor: "cli"
      })
    ).toThrow();

    expect(db.settings.get("access_key_hash")).toEqual(oldHash);
    expect(db.settings.get("auth_sessions")).toEqual(sessions);
    db.close();
  });
});
