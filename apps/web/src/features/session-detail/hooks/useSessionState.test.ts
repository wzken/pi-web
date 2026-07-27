import type {
  PiMessage,
  RealtimeEvent,
  SessionSnapshot
} from "@pi-web/protocol";
import { describe, expect, it } from "vitest";
import type { SessionDetailState } from "../types";
import { sessionDetailReducer } from "./useSessionState";

function makeSnapshot(
  messages: PiMessage[] = [],
  sequence = 10
): SessionSnapshot {
  return {
    session: {
      id: "session-1",
      status: "running"
    },
    messages,
    entries: [],
    state: null,
    queuedMessages: { steering: [], followUp: [] },
    tree: null,
    sequence,
    truncated: false,
    nextCursor: null
  } as unknown as SessionSnapshot;
}

function makeState(snapshot: SessionSnapshot | null): SessionDetailState {
  return {
    snapshot,
    activities: [],
    liveText: "partial",
    error: null,
    connectionState: "connected",
    replayBusy: false,
    controlBusy: null,
    clock: 0,
    queuedMessages: { steering: [], followUp: [] }
  };
}

describe("sessionDetailReducer", () => {
  it("replaces a refreshed snapshot and clears completed stream text", () => {
    const snapshot = makeSnapshot([{ role: "assistant", content: "done" }]);
    const next = sessionDetailReducer(makeState(null), {
      type: "snapshot.refreshed",
      snapshot
    });

    expect(next.snapshot).toBe(snapshot);
    expect(next.liveText).toBe("");
  });

  it("applies a realtime event through one state transition", () => {
    const event: RealtimeEvent = {
      sessionId: "session-1",
      sequence: 11,
      type: "pi.message_update",
      timestamp: "2026-01-01T00:00:00.000Z",
      payload: { text: " next" }
    };
    const next = sessionDetailReducer(makeState(makeSnapshot()), {
      type: "realtime.event",
      event
    });

    expect(next.liveText).toBe("partial next");
    expect(next.snapshot?.sequence).toBe(11);
  });

  it("prepends older history only to the active session", () => {
    const current = makeSnapshot([{ role: "assistant", content: "new" }]);
    const older = {
      ...makeSnapshot([{ role: "user", content: "old" }], 5),
      truncated: true,
      nextCursor: "next-page"
    };
    const next = sessionDetailReducer(makeState(current), {
      type: "history.loaded",
      snapshot: older,
      sessionId: "session-1"
    });

    expect(next.snapshot?.messages.map((message) => message.content)).toEqual([
      "old",
      "new"
    ]);
    expect(next.snapshot?.nextCursor).toBe("next-page");
  });
});
