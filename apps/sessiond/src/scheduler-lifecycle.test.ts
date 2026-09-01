import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { PiWebConfig } from "@pi-web/config";
import type {
  ScheduledJob,
  ScheduledRun,
  SessionRecord
} from "@pi-web/protocol";
import { NotificationCenter } from "./notification-center.js";
import { PiManager } from "./pi-manager.js";
import { Scheduler } from "./scheduler.js";
import { ScheduleStore } from "./schedule-store.js";
import { SessionSupervisor } from "./supervisor.js";

describe("Scheduler lifecycle", () => {
  it("drains an in-flight trigger before shutdown completes", async () => {
    let databaseClosed = false;
    let releaseCreate!: (session: SessionRecord) => void;
    let markCreateStarted!: () => void;
    const createStarted = new Promise<void>((resolve) => {
      markCreateStarted = resolve;
    });
    const created = new Promise<SessionRecord>((resolve) => {
      releaseCreate = resolve;
    });
    const job = {
      id: "job-1",
      name: "Lifecycle",
      enabled: true,
      cronExpression: "* * * * *",
      timezone: "UTC",
      cwd: process.cwd(),
      prompt: "check lifecycle",
      model: null,
      thinkingLevel: null,
      timeoutSeconds: 60,
      overlapPolicy: "skip",
      nextRunAt: new Date().toISOString()
    } as ScheduledJob;
    const run = {
      id: "run-1",
      jobId: job.id,
      status: "running"
    } as ScheduledRun;
    const updateRun = vi.fn(
      (id: string, patch: Partial<ScheduledRun>) => {
        if (databaseClosed) throw new Error("database used after close");
        return { ...run, id, ...patch } as ScheduledRun;
      }
    );
    let returnedDueJob = false;
    const schedules = {
        dueJobs: () => {
          if (databaseClosed) throw new Error("database used after close");
          if (returnedDueJob) return [];
          returnedDueJob = true;
          return [job];
        },
        updateJobTimes: vi.fn(),
        activeRunForJob: () => null,
        createRun: () => run,
        updateRun
    } as unknown as ScheduleStore;
    class DeferredSupervisor extends EventEmitter {
      readonly create = vi.fn(async () => {
        markCreateStarted();
        return await created;
      });
      readonly close = vi.fn(async () => undefined);
    }
    const supervisor =
      new DeferredSupervisor() as unknown as SessionSupervisor;
    const scheduler = new Scheduler(
      schedules,
      supervisor,
      {} as PiManager,
      {
        maxConcurrentWorkers: 1
      } as PiWebConfig,
      {} as NotificationCenter
    );

    const ticking = scheduler.tick();
    await createStarted;
    let shutdownSettled = false;
    const shuttingDown = scheduler.shutdown().then(() => {
      shutdownSettled = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(shutdownSettled).toBe(false);

    releaseCreate({
      id: "session-1"
    } as SessionRecord);
    await Promise.all([ticking, shuttingDown]);
    expect(updateRun).toHaveBeenLastCalledWith(
      run.id,
      expect.objectContaining({ status: "cancelled" })
    );

    databaseClosed = true;
    await expect(scheduler.tick()).resolves.toBeUndefined();
  });
});
