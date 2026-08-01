import type {
  RealtimeEvent,
  SessionSnapshot
} from "@pi-web/protocol";
import { describe, expect, it } from "vitest";
import type { SessionDetailState } from "../types";
import {
  applyRealtimeEvent,
  mergeActivityEvent,
  shouldReconcileSnapshot,
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
    state,
    sessionStats: null,
    recentToolEvents: [],
    liveText: "",
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
    firstItemIndex: 1_000_000,
    clock: 0
  };
}

describe("session events", () => {
  it("extracts only realtime tool events from a snapshot", () => {
    const event = makeEvent("pi.tool_execution_start", {
      toolCallId: "tool-1"
    });
    const snapshot = {
      ...makeSnapshot(),
      recentToolEvents: [event, null, { type: "invalid" }]
    } as unknown as SessionSnapshot;

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

  it("bounds the browser's rebuildable live-text projection", () => {
    const next = applyRealtimeEvent(
      { ...makeState(), liveText: "a".repeat(750_000) },
      makeEvent("pi.message_update", {
        delta: { text: "b".repeat(750_000) }
      })
    );

    expect(next.liveText).toHaveLength(1_000_000);
    expect(next.liveText.startsWith("a")).toBe(true);
    expect(next.liveText.endsWith("b")).toBe(true);
  });

  it("clears streaming text only at ordered Pi lifecycle boundaries", () => {
    const state = { ...makeState(), liveText: "old response" };
    const started = applyRealtimeEvent(
      state,
      makeEvent("pi.agent_start", {}, 5)
    );
    const streamed = applyRealtimeEvent(
      started,
      makeEvent("pi.message_update", { delta: "new response" }, 6)
    );
    const ended = applyRealtimeEvent(
      streamed,
      makeEvent("pi.message_end", {}, 7)
    );

    expect(started.liveText).toBe("");
    expect(streamed.liveText).toBe("new response");
    expect(ended.liveText).toBe("");
  });

  it("ignores Pi thinking and tool-call streaming in live answer text", () => {
    const thinking = applyRealtimeEvent(
      makeState(),
      makeEvent("pi.message_update", {
        assistantMessageEvent: {
          type: "thinking_delta",
          delta: "private reasoning"
        }
      })
    );
    const toolCall = applyRealtimeEvent(
      thinking,
      makeEvent(
        "pi.message_update",
        {
          assistantMessageEvent: {
            type: "toolcall_delta",
            delta: "{\"path\":\"secret\"}"
          }
        },
        6
      )
    );

    expect(toolCall.liveText).toBe("");
  });

  it("replaces queued messages from realtime queue updates", () => {
    const next = applyRealtimeEvent(
      makeState(),
      makeEvent("pi.queue_update", {
        steering: ["focus on errors", 42],
        followUp: ["summarize"]
      })
    );

    expect(next.snapshot?.queuedMessages).toEqual({
      steering: ["focus on errors"],
      followUp: ["summarize"]
    });
  });

  it("identifies events that close a projection segment", () => {
    expect(
      shouldReconcileSnapshot(makeEvent("pi.message_end", null))
    ).toBe(true);
    expect(
      shouldReconcileSnapshot(makeEvent("pi.agent_settled", null))
    ).toBe(true);
    expect(
      shouldReconcileSnapshot(makeEvent("pi.message_update", null))
    ).toBe(false);
  });
});
