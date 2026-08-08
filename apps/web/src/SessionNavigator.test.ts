import { describe, expect, it } from "vitest";
import type { SessionRecord } from "@pi-web/protocol";
import {
  buildSidebarProjects,
  compareSidebarSessions
} from "./SessionNavigator";

describe("buildSidebarProjects", () => {
  it("uses normalized working folders as projects and counts their chats", () => {
    const projects = buildSidebarProjects([
      session("one", "C:\\Work\\pi-web", "2026-08-03T03:00:00.000Z"),
      session("two", "c:/work/pi-web/", "2026-08-03T04:00:00.000Z"),
      session("three", "C:\\Work\\docs", "2026-08-03T02:00:00.000Z")
    ]);

    expect(projects).toEqual([
      expect.objectContaining({
        cwd: "C:\\Work\\pi-web",
        name: "pi-web",
        sessionCount: 2,
        updatedAt: "2026-08-03T04:00:00.000Z"
      }),
      expect.objectContaining({
        cwd: "C:\\Work\\docs",
        name: "docs",
        sessionCount: 1
      })
    ]);
  });

  it("pins the selected project and keeps same-named folders distinct", () => {
    const projects = buildSidebarProjects(
      [
        session("one", "/teams/alpha/app", "2026-08-03T05:00:00.000Z"),
        session("two", "/teams/beta/app", "2026-08-03T06:00:00.000Z")
      ],
      "/teams/alpha/app"
    );

    expect(projects.map((project) => project.cwd)).toEqual([
      "/teams/alpha/app",
      "/teams/beta/app"
    ]);
  });

  it("includes the selected folder before its first chat exists", () => {
    expect(buildSidebarProjects([], "D:\\new-project")).toEqual([
      {
        cwd: "D:\\new-project",
        name: "new-project",
        sessionCount: 0,
        updatedAt: ""
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
