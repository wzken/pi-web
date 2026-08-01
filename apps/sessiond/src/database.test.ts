import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionDatabase } from "./database.js";

describe("SessionDatabase", () => {
  it("durably reuses create mutation IDs and rejects payload changes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-web-db-mutation-"));
    const file = join(directory, "test.sqlite");
    const db = new SessionDatabase(file);
    const first = db.createOrReuseSession({
      cwd: directory,
      displayName: "first",
      createdBy: "web",
      mutationId: "mutation-1",
      mutationFingerprint: "fingerprint-1"
    });
    const concurrentRetry = db.createOrReuseSession({
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
      db.createOrReuseSession({
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
    const distinct = db.createOrReuseSession({
      cwd: directory,
      displayName: "second",
      createdBy: "web",
      mutationId: "mutation-2",
      mutationFingerprint: "fingerprint-2"
    });
    expect(distinct.session.id).not.toBe(first.session.id);
    db.close();

    const reopened = new SessionDatabase(file);
    expect(reopened.findCreateMutation("mutation-1")).toMatchObject({
      session: { id: first.session.id },
      fingerprint: "fingerprint-1",
      completed: false
    });
    reopened.completeCreateMutation(first.session.id, "mutation-1");
    expect(reopened.findCreateMutation("mutation-1")?.completed).toBe(true);
    reopened.close();
  });

  it("uses WAL, marks orphaned sessions interrupted, and retains run history", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-web-db-"));
    const db = new SessionDatabase(join(directory, "test.sqlite"));
    const journal = db.db.prepare("PRAGMA journal_mode").get() as {
      journal_mode: string;
    };
    expect(journal.journal_mode.toLowerCase()).toBe("wal");
    db.setSetting("temporary", { enabled: true });
    expect(db.getSetting("temporary")).toEqual({ enabled: true });
    db.deleteSetting("temporary");
    expect(db.getSetting("temporary")).toBeNull();
    const session = db.createSession({
      cwd: directory,
      displayName: "test",
      systemPrompt: "Always run the tests.",
      createdBy: "web"
    });
    expect(db.getSession(session.id).systemPrompt).toBe("Always run the tests.");
    const renamed = db.renameSession(session.id, "renamed session");
    expect(renamed.displayName).toBe("renamed session");
    expect(renamed.updatedAt >= session.updatedAt).toBe(true);
    expect(db.markOrphanedSessionsInterrupted()).toBe(1);
    expect(db.getSession(session.id).status).toBe("interrupted");
    const waiting = db.createSession({
      cwd: directory,
      displayName: "waiting worker",
      createdBy: "web"
    });
    db.updateSession(waiting.id, { status: "waiting" });
    expect(db.markOrphanedSessionsInterrupted()).toBe(1);
    expect(db.getSession(waiting.id).status).toBe("interrupted");
    const job = db.createJob(
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
    const orphanedRun = db.createRun({
      jobId: job.id,
      scheduledFor: new Date().toISOString(),
      triggerType: "manual",
      status: "running",
      sessionId: session.id
    });
    expect(db.markOrphanedRunsFailed()).toBe(1);
    expect(db.getRun(orphanedRun.id)).toMatchObject({
      status: "failed",
      errorSummary: "sessiond restarted while the scheduled run was active"
    });
    expect(db.activeRunForJob(job.id)).toBeNull();
    const run = db.createRun({
      jobId: job.id,
      scheduledFor: new Date().toISOString(),
      triggerType: "manual",
      status: "succeeded",
      sessionId: session.id
    });
    db.deleteJob(job.id, "web");
    expect(db.listJobs()).toHaveLength(0);
    expect(db.listRuns(job.id)[0]?.id).toBe(run.id);
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
    db.setSetting("auth_sessions", [{ id: "old-session" }]);

    db.rotateAccessKey({
      hash,
      auditType: "access_key.reset",
      actor: "web"
    });

    expect(db.getSetting("access_key_hash")).toEqual(hash);
    expect(db.getSetting("auth_sessions")).toBeNull();
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
    const session = db.createSession({
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

    db.updateUsage(session.id, usage(100));
    db.updateUsage(session.id, usage(80));
    db.updateUsage(session.id, usage(120));

    expect(db.getSession(session.id)).toMatchObject(usage(120));
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
    expect(() => db.updateUsage(session.id, usage(140))).toThrow(
      "daily usage failed"
    );
    expect(db.getSession(session.id)).toMatchObject(usage(120));
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
    db.setSetting("access_key_hash", oldHash);
    db.setSetting("auth_sessions", sessions);
    db.db.exec(`
      CREATE TRIGGER fail_access_key_audit
      BEFORE INSERT ON audit_events
      WHEN NEW.type = 'access_key.reset'
      BEGIN
        SELECT RAISE(ABORT, 'audit failed');
      END;
    `);

    expect(() =>
      db.rotateAccessKey({
        hash: {
          algorithm: "scrypt",
          salt: "new-salt",
          hash: "new-hash"
        },
        auditType: "access_key.reset",
        actor: "cli"
      })
    ).toThrow();

    expect(db.getSetting("access_key_hash")).toEqual(oldHash);
    expect(db.getSetting("auth_sessions")).toEqual(sessions);
    db.close();
  });
});
