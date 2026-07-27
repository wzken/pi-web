import { CronExpressionParser } from "cron-parser";
import type { JobInput } from "@pi-web/protocol";
import { jobInputSchema } from "@pi-web/protocol";
import type { PiWebConfig } from "@pi-web/config";
import { PiWebError, resolveAllowedDirectory } from "@pi-web/shared";

export interface ValidatedSchedule {
  input: JobInput;
  nextRunAt: string;
  human: string;
}

export async function validateSchedule(
  raw: unknown,
  config: PiWebConfig
): Promise<ValidatedSchedule> {
  const candidate =
    raw && typeof raw === "object"
      ? (raw as Record<string, unknown>)
      : {};
  const input = jobInputSchema.parse({
    ...candidate,
    timezone: candidate.timezone ?? config.defaultTimezone,
    timeoutSeconds:
      candidate.timeoutSeconds ?? config.defaultCronTimeoutSeconds
  });
  try {
    new Intl.DateTimeFormat("en", { timeZone: input.timezone }).format();
  } catch {
    throw new PiWebError("INVALID_TIMEZONE", "Timezone must be a valid IANA name", 400);
  }
  await resolveAllowedDirectory(
    input.cwd,
    config.allowedRoots,
    config.allowAnyDirectory
  );
  if (input.timeoutSeconds > 86_400) {
    throw new PiWebError("INVALID_TIMEOUT", "Timeout cannot exceed 24 hours", 400);
  }
  if (input.model && !/^[^/\s]+\/[^/\s].+$/.test(input.model)) {
    throw new PiWebError("INVALID_MODEL", "Model must be provider/model-id", 400);
  }

  let interval;
  try {
    interval = CronExpressionParser.parse(input.cronExpression, {
      tz: input.timezone,
      currentDate: new Date()
    });
  } catch (error) {
    throw new PiWebError(
      "INVALID_CRON",
      error instanceof Error ? error.message : "Invalid cron expression",
      400
    );
  }
  const first = interval.next().toDate();
  const second = interval.next().toDate();
  const minutes = (second.getTime() - first.getTime()) / 60_000;
  if (
    minutes < config.minimumCronIntervalMinutes &&
    process.env.PI_WEB_ALLOW_FAST_CRON !== "true"
  ) {
    throw new PiWebError(
      "CRON_TOO_FREQUENT",
      `Schedules must be at least ${config.minimumCronIntervalMinutes} minutes apart`,
      400
    );
  }
  return {
    input,
    nextRunAt: first.toISOString(),
    human: humanizeCron(input.cronExpression, input.timezone)
  };
}

export function nextOccurrence(
  expression: string,
  timezone: string,
  after = new Date()
): string {
  return CronExpressionParser.parse(expression, {
    tz: timezone,
    currentDate: after
  })
    .next()
    .toDate()
    .toISOString();
}

export function humanizeCron(expression: string, timezone: string): string {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return `${expression} (${timezone})`;
  const [minute = "*", hour = "*", day = "*", month = "*", weekday = "*"] =
    fields;
  if (day === "*" && month === "*" && weekday === "*") {
    if (hour === "*" && minute.startsWith("*/")) {
      return `Every ${minute.slice(2)} minutes · ${timezone}`;
    }
    if (/^\d+$/.test(hour) && /^\d+$/.test(minute)) {
      return `Daily at ${hour.padStart(2, "0")}:${minute.padStart(2, "0")} · ${timezone}`;
    }
  }
  return `${expression} · ${timezone}`;
}
