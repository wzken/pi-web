import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionRecord } from "@pi-web/protocol";
import {
  fetchAllSessions,
  invalidateSessionListRequest
} from "./useSessionList";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("session-list mutation ordering", () => {
  it("loads every cursor page without duplicating overlapping sessions", async () => {
    const session = (id: string): SessionRecord => ({
      id,
      piSessionReference: null,
      cwd: "/workspace",
      displayName: id,
      status: "closed",
      workerPid: null,
      model: null,
      thinkingLevel: null,
      systemPrompt: null,
      startedAt: "2026-08-12T00:00:00.000Z",
      settledAt: null,
      endedAt: null,
      exitCode: null,
      interruptionReason: null,
      lastEventSequence: 0,
      createdBy: "web",
      scheduleRunId: null,
      updatedAt: "2026-08-12T00:00:00.000Z",
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      reportedCost: null,
      estimatedCost: null,
      costStatus: "unknown",
      toolCalls: 0
    });
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sessions: [session("one"), session("two")],
            nextCursor: "cursor-2"
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sessions: [session("two"), session("three")],
            nextCursor: null
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );

    await expect(fetchAllSessions()).resolves.toEqual([
      session("one"),
      session("two"),
      session("three")
    ]);
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      "/api/sessions?limit=100",
      expect.any(Object)
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      "/api/sessions?limit=100&cursor=cursor-2",
      expect.any(Object)
    );
  });

  it("rejects a repeated cursor instead of looping forever", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ sessions: [], nextCursor: "repeated" }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    await expect(fetchAllSessions()).rejects.toThrow(
      "Session pagination returned a repeated cursor"
    );
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("invalidates and aborts a refresh before applying a local mutation", () => {
    const abort = vi.fn();
    const generation = { current: 7 };
    const controller = {
      current: { abort } as unknown as AbortController
    };

    invalidateSessionListRequest(generation, controller);

    expect(generation.current).toBe(8);
    expect(abort).toHaveBeenCalledOnce();
    expect(controller.current).toBeNull();
  });
});
