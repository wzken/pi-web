import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionDatabase } from "./database.js";

describe("SessionDatabase", () => {
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
});
