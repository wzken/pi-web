import { homedir } from "node:os";
import { describe, expect, it } from "vitest";
import type { PiWebConfig } from "@pi-web/config";
import { nextOccurrence, validateSchedule } from "./cron.js";

const config: PiWebConfig = {
  host: "0.0.0.0",
  port: 8787,
  allowedRoots: [homedir()],
  allowAnyDirectory: true,
  defaultTimezone: "UTC",
  defaultCronTimeoutSeconds: 3600,
  minimumCronIntervalMinutes: 5,
  modelSchedulePolicy: "allow",
  piExecutable: "pi",
  trustedProxy: false,
  cookieSecure: "auto",
  defaultModel: null,
  defaultThinkingLevel: null,
  defaultSystemPrompt: null,
  maxScheduledJobs: 200,
  maxConcurrentWorkers: 8,
  eventBufferSize: 2000
};

describe("Cron validation", () => {
  it("calculates a timezone-aware future occurrence", async () => {
    const result = await validateSchedule(
      {
        name: "daily",
        enabled: true,
        cronExpression: "0 9 * * *",
        timezone: "Asia/Tokyo",
        cwd: homedir(),
        prompt: "Run tests",
        model: null,
        thinkingLevel: null,
        timeoutSeconds: 3600,
        overlapPolicy: "skip"
      },
      config
    );
    expect(new Date(result.nextRunAt).getTime()).toBeGreaterThan(Date.now());
    expect(result.human).toContain("Asia/Tokyo");
  });

  it("rejects schedules below the configured interval", async () => {
    await expect(
      validateSchedule(
        {
          name: "too fast",
          cronExpression: "* * * * *",
          timezone: "UTC",
          cwd: homedir(),
          prompt: "x",
          timeoutSeconds: 60,
          enabled: true,
          model: null,
          thinkingLevel: null,
          overlapPolicy: "skip"
        },
        config
      )
    ).rejects.toMatchObject({ code: "CRON_TOO_FREQUENT" });
  });

  it("does not backfill because nextOccurrence starts after now", () => {
    const next = nextOccurrence("0 * * * *", "UTC", new Date("2026-01-01T10:30:00Z"));
    expect(next).toBe("2026-01-01T11:00:00.000Z");
  });
});
