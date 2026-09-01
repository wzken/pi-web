import { describe, expect, it } from "vitest";
import type { SessionRecord } from "@pi-web/protocol";
import {
  buildStandaloneSessions,
  buildSidebarProjects,
  compareSidebarSessions
} from "./features/session-navigation/session-navigation";

describe("buildSidebarProjects", () => {
  it("uses favorite working folders as projects and nests their chats", () => {
    const sessions = [
      session("one", "C:\\Work\\pi-web", "2026-08-03T03:00:00.000Z"),
      session("two", "c:/work/pi-web/", "2026-08-03T04:00:00.000Z"),
      session("standalone", "C:\\Work\\notes", "2026-08-03T02:00:00.000Z")
    ];
    const projects = buildSidebarProjects(sessions, [directory("C:\\Work\\pi-web")]);

    expect(projects).toEqual([
      expect.objectContaining({
        cwd: "C:\\Work\\pi-web",
        name: "pi-web",
        sessionCount: 2,
        updatedAt: "2026-08-03T04:00:00.000Z",
        sessions: [sessions[0], sessions[1]]
      })
    ]);
    expect(buildStandaloneSessions(sessions, projects).map(({ id }) => id)).toEqual([
      "standalone"
    ]);
  });

  it("pins the selected project and keeps same-named folders distinct", () => {
    const projects = buildSidebarProjects(
      [
        session("one", "/teams/alpha/app", "2026-08-03T05:00:00.000Z"),
        session("two", "/teams/beta/app", "2026-08-03T06:00:00.000Z")
      ],
      [directory("/teams/alpha/app"), directory("/teams/beta/app")],
      "/teams/alpha/app"
    );

    expect(projects.map((project) => project.cwd)).toEqual([
      "/teams/alpha/app",
      "/teams/beta/app"
    ]);
  });

  it("includes the selected folder before its first chat exists", () => {
    expect(buildSidebarProjects([], [directory("D:\\new-project")], "D:\\new-project")).toEqual([
      {
        cwd: "D:\\new-project",
        name: "new-project",
        sessionCount: 0,
        updatedAt: "2026-08-03T00:00:00.000Z",
        sessions: []
      }
    ]);
  });
});

describe("compareSidebarSessions", () => {
  it("keeps pinned sessions ahead of newer unpinned sessions", () => {
    const pinned = {
      ...session("pinned", "/workspace", "2026-08-03T02:00:00.000Z"),
      pinned: true,
      pinnedAt: "2026-08-03T03:00:00.000Z"
    };
    const newer = session(
      "newer",
      "/workspace",
      "2026-08-03T04:00:00.000Z"
    );

    expect([newer, pinned].sort(compareSidebarSessions).map(({ id }) => id)).toEqual([
      "pinned",
      "newer"
    ]);
  });

  it("orders multiple pinned sessions by their pin time", () => {
    const first = {
      ...session("first", "/workspace", "2026-08-03T05:00:00.000Z"),
      pinned: true,
      pinnedAt: "2026-08-03T06:00:00.000Z"
    };
    const second = {
      ...session("second", "/workspace", "2026-08-03T04:00:00.000Z"),
      pinned: true,
      pinnedAt: "2026-08-03T07:00:00.000Z"
    };

    expect([first, second].sort(compareSidebarSessions).map(({ id }) => id)).toEqual([
      "second",
      "first"
    ]);
  });
});

function session(id: string, cwd: string, updatedAt: string): SessionRecord {
  return {
    id,
    piSessionReference: null,
    cwd,
    displayName: id,
    status: "closed",
    workerPid: null,
    model: null,
    thinkingLevel: null,
    systemPrompt: null,
    startedAt: updatedAt,
    settledAt: updatedAt,
    endedAt: updatedAt,
    exitCode: 0,
    interruptionReason: null,
    lastEventSequence: 0,
    createdBy: "web",
    scheduleRunId: null,
    updatedAt,
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    reportedCost: null,
    estimatedCost: null,
    costStatus: "unknown",
    toolCalls: 0
  };
}

function directory(path: string) {
  return {
    path,
    alias: null,
    favorite: true,
    lastUsedAt: "2026-08-03T00:00:00.000Z"
  };
}
