import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { PiWebConfig } from "@pi-web/config";
import type { ScheduledJob } from "@pi-web/protocol";
import { SessionDatabase } from "./database.js";
import { PiManager } from "./pi-manager.js";
import { Scheduler } from "./scheduler.js";
import { SessionSupervisor } from "./supervisor.js";

describe("Scheduler model validation", () => {
  it("rejects an unavailable model before creating a scheduled job", async () => {
    const db = {
      countJobs: vi.fn(() => 0),
      createJob: vi.fn()
    } as unknown as SessionDatabase;
    const piManager = {
      modelExists: vi.fn(async () => false)
    } as unknown as PiManager;
    const scheduler = new Scheduler(
      db,
      new EventEmitter() as SessionSupervisor,
      piManager,
      config()
    );

    await expect(
      scheduler.create(
        {
          name: "Unavailable model",
          cronExpression: "0 0 * * *",
          timezone: "UTC",
          cwd: process.cwd(),
          prompt: "Run the review",
          model: "unknown/model"
        },
        { actor: "web" }
      )
    ).rejects.toMatchObject({ code: "MODEL_NOT_FOUND", statusCode: 400 });

    expect(piManager.modelExists).toHaveBeenCalledWith("unknown/model");
    expect(db.createJob).not.toHaveBeenCalled();
  });

  it("rejects an unavailable model before updating a scheduled job", async () => {
    const updateJob = vi.fn();
    const db = {
      getJob: vi.fn(() => existingJob()),
      updateJob
    } as unknown as SessionDatabase;
    const piManager = {
      modelExists: vi.fn(async () => false)
    } as unknown as PiManager;
    const scheduler = new Scheduler(
      db,
      new EventEmitter() as SessionSupervisor,
      piManager,
      config()
    );

    await expect(
      scheduler.update(
        "8ab2c94b-f1c0-4c81-a741-ea019e089471",
        { model: "unknown/model" },
        "web"
      )
    ).rejects.toMatchObject({ code: "MODEL_NOT_FOUND", statusCode: 400 });

    expect(piManager.modelExists).toHaveBeenCalledWith("unknown/model");
    expect(updateJob).not.toHaveBeenCalled();
  });
});

function config(): PiWebConfig {
  return {
    maxScheduledJobs: 10,
    allowedRoots: [process.cwd()],
    allowAnyDirectory: false,
    defaultTimezone: "UTC",
    defaultCronTimeoutSeconds: 3600,
    minimumCronIntervalMinutes: 1
  } as PiWebConfig;
}

function existingJob(): ScheduledJob {
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
    nextRunAt: null
  };
}
