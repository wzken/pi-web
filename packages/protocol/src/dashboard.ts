import type { ScheduledRun } from "./schedules.js";
import type { SessionRecord } from "./sessions.js";

export interface DashboardSummary {
  runningSessions: number;
  sessionsToday: number;
  cronRunsToday: number;
  inputTokensToday: number;
  outputTokensToday: number;
  reportedCostToday: number;
  recentSessions: SessionRecord[];
  recentRuns: ScheduledRun[];
  recentProblems: SessionRecord[];
}
