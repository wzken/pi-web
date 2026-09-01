import type {
  PiMessage,
  RealtimeEvent,
  SessionSnapshot
} from "@pi-web/protocol";
import { describe, expect, it } from "vitest";
import type { SessionDetailState } from "../types";
import {
  clearSessionCursor,
  initialSessionFirstItemIndex,
  readSessionCursor,
  writeSessionCursor,
  sessionDetailReducer
} from "./useSessionState";

const epoch = "11111111-1111-4111-8111-111111111111";

function makeSnapshot(
  messages: PiMessage[] = [],
  sequence = 10,
  status: SessionSnapshot["session"]["status"] = "running",
  liveText = ""
): SessionSnapshot {
  return {
    session: {
      id: "session-1",
      status
    },
    messages,
    state: null,
    sessionStats: null,
    recentToolEvents: [],
    liveText,
    queuedMessages: { steering: [], followUp: [] },
    pendingInteractions: [],
    tree: null,
    projectionEpoch: epoch,
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
    firstItemIndex: initialSessionFirstItemIndex,
    clock: 0
  };
}

describe("sessionDetailReducer", () => {
  it("replaces the projection snapshot and clears completed stream text", () => {
    const snapshot = makeSnapshot([{ role: "assistant", content: "done" }]);
    const next = sessionDetailReducer(makeState(null), {
      type: "projection.replaced",
      snapshot
    });

    expect(next.snapshot).toBe(snapshot);
    expect(next.liveText).toBe("");
  });

  it("restores bounded in-flight text from the authoritative snapshot", () => {
    const snapshot = makeSnapshot([], 10, "running", "restored response");
    const next = sessionDetailReducer(makeState(null), {
      type: "projection.replaced",
      snapshot
    });

    expect(next.liveText).toBe("restored response");
  });

  it("resets activity projection for a synchronized snapshot", () => {
    const state = {
      ...makeState(makeSnapshot()),
      activities: [
        {
          id: "old-tool",
          type: "pi.tool_execution_start",
          name: "read",
          status: "running" as const,
          payload: {},
          at: "2026-01-01T00:00:00.000Z"
        }
      ]
    };
    const next = sessionDetailReducer(state, {
      type: "projection.replaced",
      snapshot: makeSnapshot()
    });

    expect(next.activities).toEqual([]);
  });

  it("accepts a lower authoritative snapshot after the old projection is reset", () => {
    const discarded = sessionDetailReducer(makeState(makeSnapshot([], 10)), {
      type: "reset"
    });
    const authoritative = makeSnapshot([], 2, "interrupted");
    const next = sessionDetailReducer(discarded, {
      type: "projection.replaced",
      snapshot: authoritative
    });

    expect(next.snapshot).toBe(authoritative);
    expect(next.snapshot?.sequence).toBe(2);
    expect(next.snapshot?.session.status).toBe("interrupted");
  });

  it("applies a realtime event through one state transition", () => {
    const event: RealtimeEvent = {
      sessionId: "session-1",
      projectionEpoch: epoch,
      sequence: 11,
      type: "pi.message_update",
      timestamp: "2026-01-01T00:00:00.000Z",
      payload: { text: " next" }
    };
    const next = sessionDetailReducer(makeState(makeSnapshot()), {
      type: "projection.event",
      event
    });

    expect(next.liveText).toBe("partial next");
    expect(next.snapshot?.sequence).toBe(11);
  });

  it("keeps the timeline index stable when reconciliation appends messages", () => {
    const current = makeSnapshot([
      { role: "user", content: "question", timestamp: 1 },
      { role: "assistant", content: "answer", timestamp: 2 }
    ]);
    const state = {
      ...makeState(current),
      firstItemIndex: initialSessionFirstItemIndex - 20
    };
    const next = sessionDetailReducer(state, {
      type: "projection.replaced",
      snapshot: makeSnapshot([
        ...current.messages,
        { role: "assistant", content: "next", timestamp: 3 }
      ])
    });

    expect(next.firstItemIndex).toBe(state.firstItemIndex);
  });

  it("keeps shared messages at the same absolute index when the snapshot window advances", () => {
    const current = makeSnapshot([
      { role: "user", content: "old", timestamp: 1 },
      { role: "assistant", content: "shared", timestamp: 2 }
    ]);
    const state = {
      ...makeState(current),
      firstItemIndex: initialSessionFirstItemIndex - 20
    };
    const next = sessionDetailReducer(state, {
      type: "projection.replaced",
      snapshot: makeSnapshot([
        current.messages[1]!,
        { role: "assistant", content: "new", timestamp: 3 }
      ])
    });

    expect(next.firstItemIndex).toBe(state.firstItemIndex + 1);
  });

  it("counts grouped tool results as one item when prepending history", () => {
    const current = makeSnapshot([{ role: "assistant", content: "new" }]);
    const older = makeSnapshot([
      { role: "toolResult", content: "first", toolCallId: "tool-1" },
      { role: "toolResult", content: "second", toolCallId: "tool-2" }
    ]);
    const next = sessionDetailReducer(makeState(current), {
      type: "history.loaded",
      snapshot: older,
      sessionId: "session-1"
    });

    expect(next.firstItemIndex).toBe(initialSessionFirstItemIndex - 1);
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
    expect(next.firstItemIndex).toBe(
      initialSessionFirstItemIndex - older.messages.length
    );
  });
});

describe("session projection cursor storage", () => {
  it("stores and clears resume metadata under the session-specific key", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => void values.delete(key)
    };

    const cursor = { projectionEpoch: epoch, sequence: 42 };
    writeSessionCursor("session-1", cursor, storage);
    expect(JSON.parse(readSessionCursor("session-1", storage) ?? "null")).toEqual(
      cursor
    );

    clearSessionCursor("session-1", storage);
    expect(readSessionCursor("session-1", storage)).toBeNull();
  });

  it("keeps sequence metadata best-effort when storage is unavailable", () => {
    const unavailable = {
      getItem: (_key: string): string | null => {
        throw new DOMException("blocked", "SecurityError");
      },
      setItem: (_key: string, _value: string): void => {
        throw new DOMException("blocked", "SecurityError");
      },
      removeItem: (_key: string): void => {
        throw new DOMException("blocked", "SecurityError");
      }
    };

    expect(readSessionCursor("session-1", unavailable)).toBeNull();
    expect(() =>
      writeSessionCursor(
        "session-1",
        { projectionEpoch: epoch, sequence: 42 },
        unavailable
      )
    ).not.toThrow();
    expect(() => clearSessionCursor("session-1", unavailable)).not.toThrow();
  });
});
