import type { SessionRecord } from "@pi-web/protocol";
import { describe, expect, it } from "vitest";
import {
  parseSessionSortOrder,
  parseSessionViewFilter,
  projectSessions
} from "./session-list-projection";

const baseSession: SessionRecord = {
  id: "base",
  piSessionReference: null,
  cwd: "/workspace/base",
  displayName: "Base session",
  status: "closed",
  workerPid: null,
  model: null,
  thinkingLevel: null,
  systemPrompt: null,
  startedAt: "2026-08-10T08:00:00.000Z",
  settledAt: "2026-08-10T08:10:00.000Z",
  endedAt: "2026-08-10T08:10:00.000Z",
  exitCode: 0,
  interruptionReason: null,
  lastEventSequence: 1,
  createdBy: "web",
  scheduleRunId: null,
  pinned: false,
  pinnedAt: null,
  deletedAt: null,
  updatedAt: "2026-08-10T08:10:00.000Z",
  inputTokens: 10,
  outputTokens: 5,
  cachedTokens: 0,
  reportedCost: null,
  estimatedCost: null,
  costStatus: "unknown",
  toolCalls: 1
};

function session(
  id: string,
  overrides: Partial<SessionRecord> = {}
): SessionRecord {
  return {
    ...baseSession,
    id,
    displayName: id,
    cwd: `/workspace/${id}`,
    ...overrides
  };
}

describe("session list projection", () => {
  it("falls back to the default filter and sort for invalid URL values", () => {
    expect(parseSessionViewFilter("unknown")).toBe("all");
    expect(parseSessionSortOrder("unknown")).toBe("recent");
  });

  it("filters active, attention, pinned and closed sessions", () => {
    const sessions = [
      session("running", { status: "running" }),
      session("failed", { status: "failed" }),
      session("pinned", { pinned: true }),
      session("closed")
    ];

    expect(projectSessions(sessions, { query: "", filter: "active", sort: "recent" }).map(({ id }) => id)).toEqual(["running"]);
    expect(projectSessions(sessions, { query: "", filter: "attention", sort: "recent" }).map(({ id }) => id)).toEqual(["failed"]);
    expect(projectSessions(sessions, { query: "", filter: "pinned", sort: "recent" }).map(({ id }) => id)).toEqual(["pinned"]);
    expect(projectSessions(sessions, { query: "", filter: "closed", sort: "recent" }).map(({ id }) => id)).toEqual(["pinned", "closed"]);
  });

  it("searches names, workspaces and models with normalized text", () => {
    const sessions = [
      session("frontend", { model: "provider/DeepSeek-V4" }),
      session("backend", { cwd: "/workspace/API" })
    ];

    expect(projectSessions(sessions, { query: "deepseek", filter: "all", sort: "recent" }).map(({ id }) => id)).toEqual(["frontend"]);
    expect(projectSessions(sessions, { query: "api", filter: "all", sort: "recent" }).map(({ id }) => id)).toEqual(["backend"]);
  });

  it("keeps pinned sessions first and sorts the remainder", () => {
    const sessions = [
      session("old", { updatedAt: "2026-08-01T00:00:00.000Z", toolCalls: 8 }),
      session("new", { updatedAt: "2026-08-11T00:00:00.000Z", inputTokens: 100 }),
      session("pinned", { pinned: true, updatedAt: "2026-07-01T00:00:00.000Z" })
    ];

    expect(projectSessions(sessions, { query: "", filter: "all", sort: "recent" }).map(({ id }) => id)).toEqual(["pinned", "new", "old"]);
    expect(projectSessions(sessions, { query: "", filter: "all", sort: "tools" }).map(({ id }) => id)).toEqual(["pinned", "old", "new"]);
    expect(projectSessions(sessions, { query: "", filter: "all", sort: "tokens" }).map(({ id }) => id)).toEqual(["pinned", "new", "old"]);
  });
});
