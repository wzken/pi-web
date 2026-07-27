import type {
  RealtimeEvent,
  SessionSnapshot
} from "@pi-web/protocol";
import { describe, expect, it } from "vitest";
import type { SessionDetailState } from "../types";
import {
  applyRealtimeEvent,
  mergeActivityEvent,
  snapshotToolEvents
} from "./session-events";

function makeSnapshot(
  state: Record<string, unknown> | null = null
): SessionSnapshot {
  return {
    session: {
      id: "session-1",
      status: "running"
    },
    messages: [],
    entries: [],
    state,
    queuedMessages: { steering: [], followUp: [] },
    tree: null,
    sequence: 4,
    truncated: false,
    nextCursor: null
  } as unknown as SessionSnapshot;
}

function makeEvent(
  type: string,
  payload: unknown,
  sequence = 5
): RealtimeEvent {
  return {
    sessionId: "session-1",
    sequence,
    type,
    timestamp: "2026-01-01T00:00:00.000Z",
    payload
  };
}

function makeState(): SessionDetailState {
  return {
    snapshot: makeSnapshot(),
    activities: [],
    liveText: "",
    error: null,
    connectionState: "connected",
    replayBusy: false,
    controlBusy: null,
    clock: 0,
    queuedMessages: { steering: [], followUp: [] }
  };
}

describe("session events", () => {
  it("extracts only realtime tool events from a snapshot", () => {
    const event = makeEvent("pi.tool_execution_start", {
      toolCallId: "tool-1"
    });
    const snapshot = makeSnapshot({
      recentToolEvents: [event, null, { type: "invalid" }]
    });

    expect(snapshotToolEvents(snapshot)).toEqual([event]);
  });

  it("replaces an activity when the same tool call completes", () => {
    const started = mergeActivityEvent(
      [],
      makeEvent("pi.tool_execution_start", {
        toolCallId: "tool-1",
        toolName: "read"
      })
    );
    const completed = mergeActivityEvent(
      started,
      makeEvent(
        "pi.tool_execution_end",
        {
          toolCallId: "tool-1",
          toolName: "read",
          isError: false
        },
        6
      )
    );

    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      id: "tool-1",
      name: "read",
      status: "done"
    });
  });

  it("applies streaming text and session status without losing state", () => {
    const streamed = applyRealtimeEvent(
      makeState(),
      makeEvent("pi.message_update", { delta: { text: "hello" } })
    );
    const settled = applyRealtimeEvent(
      streamed,
      makeEvent("session.status", { status: "waiting" }, 6)
    );

    expect(settled.liveText).toBe("hello");
    expect(settled.snapshot?.sequence).toBe(6);
    expect(settled.snapshot?.session.status).toBe("waiting");
  });

  it("replaces queued messages from realtime queue updates", () => {
    const next = applyRealtimeEvent(
      makeState(),
      makeEvent("pi.queue_update", {
        steering: ["focus on errors", 42],
        followUp: ["summarize"]
      })
    );

    expect(next.queuedMessages).toEqual({
      steering: ["focus on errors"],
      followUp: ["summarize"]
    });
  });
});
