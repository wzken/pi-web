// Shared status/value types used across protocol domains.

export const sessionStatuses = [
  "starting",
  "running",
  "waiting",
  "stopping",
  "failed",
  "interrupted",
  "closed"
] as const;
export type SessionStatus = (typeof sessionStatuses)[number];

export const runStatuses = [
  "scheduled",
  "running",
  "succeeded",
  "failed",
  "timed_out",
  "skipped_overlap",
  "cancelled",
  "missed"
] as const;
export type RunStatus = (typeof runStatuses)[number];

export const thinkingLevels = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
] as const;
export type ThinkingLevel = (typeof thinkingLevels)[number];

export interface UsageSummary {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reportedCost: number | null;
  estimatedCost: number | null;
  costStatus: "reported" | "estimated" | "unknown";
  toolCalls: number;
}
