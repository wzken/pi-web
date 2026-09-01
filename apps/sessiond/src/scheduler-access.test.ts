import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { PiWebConfig } from "@pi-web/config";
import type { ScheduledJob, ScheduledRun } from "@pi-web/protocol";
import { PiWebError } from "@pi-web/shared";
import { NotificationCenter } from "./notification-center.js";
import { PiManager } from "./pi-manager.js";
import { Scheduler } from "./scheduler.js";
import { ScheduleStore } from "./schedule-store.js";
import { SessionSupervisor } from "./supervisor.js";

const sessionId = "11111111-1111-4111-8111-111111111111";

describe("Scheduler model access and trigger admission", () => {
  it("lists and mutates only schedules created from the calling session", async () => {
    const own = job({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Own job",
      createdBy: "model",
      createdFromSessionId: sessionId,
      prompt: "secret from this session"
    });
    const other = job({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      name: "Other job",
      createdBy: "web",
      createdFromSessionId: null,
      prompt: "web-created secret"
    });
    const schedules = {
        listJobs: () => [own, other],
        getJob: (id: string) => {
          const found = [own, other].find((item) => item.id === id);
          if (!found) throw new PiWebError("JOB_NOT_FOUND", "missing", 404);
          return found;
        }
    } as unknown as ScheduleStore;
    const scheduler = new Scheduler(
      schedules,
      new EventEmitter() as SessionSupervisor,
      {} as PiManager,
      config(),
      {} as NotificationCenter
    );

    await expect(
      scheduler.tool({ action: "list" }, sessionId)
    ).resolves.toEqual([
      expect.objectContaining({
        id: own.id,
        prompt: own.prompt
      })
    ]);
    await expect(
      scheduler.tool({ action: "get", jobId: other.id }, sessionId)
    ).rejects.toMatchObject({ code: "MODEL_JOB_SCOPE" });
    expect(() =>
      scheduler.setEnabled(other.id, false, "model", sessionId)
    ).toThrowError(expect.objectContaining({ code: "MODEL_JOB_SCOPE" }));
  });

  it("does not notify or advance the next run when workers are full", async () => {
    const current = job({ nextRunAt: "2026-08-01T00:00:00.000Z" });
    const run = {
      id: "run-1",
      jobId: current.id,
      status: "running"
    } as ScheduledRun;
    const updateJobTimes = vi.fn();
    const scheduleFailed = vi.fn();
    const updateRun = vi.fn((id: string, patch: Partial<ScheduledRun>) => ({
      ...run,
      id,
      ...patch
    }));
    const schedules = {
        dueJobs: () => [current],
        updateJobTimes,
        activeRunForJob: () => null,
        createRun: () => run,
        updateRun
    } as unknown as ScheduleStore;
    class FullSupervisor extends EventEmitter {
      readonly create = vi.fn(async () => {
        throw new PiWebError("WORKER_LIMIT", "full", 429);
      });
    }
    const scheduler = new Scheduler(
      schedules,
      new FullSupervisor() as unknown as SessionSupervisor,
      {} as PiManager,
      config(),
      { scheduleFailed } as unknown as NotificationCenter
    );

    await scheduler.tick();

    expect(updateJobTimes).not.toHaveBeenCalled();
    expect(scheduleFailed).not.toHaveBeenCalled();
    expect(updateRun).toHaveBeenCalledWith(
      run.id,
      expect.objectContaining({ status: "cancelled" })
    );
  });

  it("records overlap skips without treating them as failures", async () => {
    const current = job({ nextRunAt: "2026-08-01T00:00:00.000Z" });
    const skipped = {
      id: "run-skip",
      jobId: current.id,
      status: "skipped_overlap"
    } as ScheduledRun;
    const updateJobTimes = vi.fn();
    const scheduleFailed = vi.fn();
    const createRun = vi.fn(() => skipped);
    const schedules = {
        dueJobs: () => [current],
        updateJobTimes,
        activeRunForJob: () => skipped,
        createRun
    } as unknown as ScheduleStore;
    const scheduler = new Scheduler(
      schedules,
      new EventEmitter() as SessionSupervisor,
      {} as PiManager,
      config(),
      { scheduleFailed } as unknown as NotificationCenter
    );

    await scheduler.tick();

    expect(createRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: "skipped_overlap" })
    );
    expect(scheduleFailed).not.toHaveBeenCalled();
    expect(updateJobTimes).toHaveBeenCalledOnce();
  });
});

function config(): PiWebConfig {
  return {
    maxScheduledJobs: 10,
    allowedRoots: [process.cwd()],
    allowAnyDirectory: false,
    defaultTimezone: "UTC",
    defaultCronTimeoutSeconds: 3600,
    minimumCronIntervalMinutes: 1,
    modelSchedulePolicy: "allow"
  } as PiWebConfig;
}

function job(overrides: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    id: "8ab2c94b-f1c0-4c81-a741-ea019e089471",
    name: "Existing schedule",
    enabled: true,
    cronExpression: "0 0 * * *",
    timezone: "UTC",
    cwd: process.cwd(),
    prompt: "Run the review",
    model: null,
    thinkingLevel: null,
    timeoutSeconds: 3600,
    overlapPolicy: "skip",
    createdBy: "web",
    createdFromSessionId: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    lastRunAt: null,
    nextRunAt: null,
    ...overrides
  };
}
