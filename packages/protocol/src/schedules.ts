import { z } from "zod";
import { thinkingLevels, type RunStatus, type ThinkingLevel } from "./common.js";

export const scheduleActions = [
  "create",
  "list",
  "get",
  "update",
  "enable",
  "disable",
  "delete",
  "run_now"
] as const;
export type ScheduleAction = (typeof scheduleActions)[number];

export interface ScheduledJob {
  id: string;
  name: string;
  enabled: boolean;
  cronExpression: string;
  timezone: string;
  cwd: string;
  prompt: string;
  model: string | null;
  thinkingLevel: ThinkingLevel | null;
  timeoutSeconds: number;
  overlapPolicy: "skip";
  createdBy: "web" | "model" | "import";
  createdFromSessionId: string | null;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

export interface ScheduledRun {
  id: string;
  jobId: string;
  sessionId: string | null;
  scheduledFor: string;
  triggerType: "cron" | "manual" | "model_run_now";
  status: RunStatus;
  startedAt: string | null;
  endedAt: string | null;
  errorSummary: string | null;
  inputTokens: number;
  outputTokens: number;
  reportedCost: number | null;
  estimatedCost: number | null;
}

export const jobInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  enabled: z.boolean().default(true),
  cronExpression: z.string().trim().min(1).max(100),
  timezone: z.string().trim().min(1).max(100),
  cwd: z.string().min(1).max(4096),
  prompt: z.string().trim().min(1).max(200_000),
  model: z.string().max(300).nullable().default(null),
  thinkingLevel: z.enum(thinkingLevels).nullable().default(null),
  timeoutSeconds: z.number().int().min(1).max(86_400).default(3600),
  overlapPolicy: z.literal("skip").default("skip")
});
export type JobInput = z.infer<typeof jobInputSchema>;
