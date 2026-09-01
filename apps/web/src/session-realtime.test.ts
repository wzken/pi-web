import { describe, expect, it, vi } from "vitest";
import {
  classifySequence,
  createSessionHeartbeat,
  isNewerSequence,
  mergeSynchronizedEvents,
  orderRealtimeEvents,
  parseSessionSocketMessage,
  projectionRecoveryDelay,
  resolveProjectionCursor,
  sessionHeartbeatIntervalMs,
  sessionHeartbeatTimeoutMs,
  shouldRefreshProjectionAfterDisconnect
} from "./session-realtime";

const epoch = "11111111-1111-4111-8111-111111111111";

describe("resolveProjectionCursor", () => {
  it("uses stored sequence only within the current epoch", () => {
    expect(
      resolveProjectionCursor(
        JSON.stringify({ projectionEpoch: epoch, sequence: 12 }),
        { projectionEpoch: epoch, sequence: 8 }
      )
    ).toEqual({ projectionEpoch: epoch, sequence: 12 });
    expect(
      resolveProjectionCursor(
        JSON.stringify({ projectionEpoch: epoch, sequence: 4 }),
        { projectionEpoch: epoch, sequence: 8 }
      )
    ).toEqual({ projectionEpoch: epoch, sequence: 8 });
  });

  it("discards corrupt metadata and cursors from another epoch", () => {
    const fallback = { projectionEpoch: epoch, sequence: 7 };
    expect(resolveProjectionCursor("not-json", fallback)).toEqual(fallback);
    expect(
      resolveProjectionCursor(
        JSON.stringify({
          projectionEpoch: "22222222-2222-4222-8222-222222222222",
          sequence: 99
        }),
        fallback
      )
    ).toEqual(fallback);
  });
});

describe("isNewerSequence", () => {
  it("accepts only strictly newer non-negative integer events", () => {
    expect(isNewerSequence(10, 11)).toBe(true);
    expect(isNewerSequence(10, 10)).toBe(false);
    expect(isNewerSequence(10, 9)).toBe(false);
    expect(isNewerSequence(10, Number.NaN)).toBe(false);
  });
});

describe("classifySequence", () => {
  it("distinguishes the next event from stale events and gaps", () => {
    expect(classifySequence(10, 11)).toBe("next");
    expect(classifySequence(10, 10)).toBe("stale");
    expect(classifySequence(10, 14)).toBe("gap");
  });
});

describe("orderRealtimeEvents", () => {
  it("orders synchronization and buffered events while keeping the first duplicate", () => {
    const event = (sequence: number, type = `event-${sequence}`) => ({
      sessionId: "session-1",
      projectionEpoch: epoch,
      sequence,
      type,
      timestamp: "2026-07-27T00:00:00.000Z",
      payload: {}
    });

    expect(
      orderRealtimeEvents([
        event(8),
        event(6),
        event(7, "sync-copy"),
        event(7, "buffered-copy")
      ]).map(({ sequence, type }) => ({ sequence, type }))
    ).toEqual([
      { sequence: 6, type: "event-6" },
      { sequence: 7, type: "sync-copy" },
      { sequence: 8, type: "event-8" }
    ]);
  });

  it("delivers replay before live events buffered ahead of the first sync", () => {
    const event = (sequence: number) => ({
      sessionId: "session-1",
      projectionEpoch: epoch,
      sequence,
      type: `event-${sequence}`,
      timestamp: "2026-07-27T00:00:00.000Z",
      payload: {}
    });

    expect(
      mergeSynchronizedEvents(
        [event(6), event(7), event(8), event(9), event(10)],
        [event(10), event(12), event(11)]
      ).map(({ sequence }) => sequence)
    ).toEqual([6, 7, 8, 9, 10, 11, 12]);
  });
});

describe("shouldRefreshProjectionAfterDisconnect", () => {
  it("refreshes a reset projection even while the page is hidden", () => {
    expect(shouldRefreshProjectionAfterDisconnect(true, "hidden")).toBe(true);
    expect(shouldRefreshProjectionAfterDisconnect(false, "hidden")).toBe(false);
    expect(shouldRefreshProjectionAfterDisconnect(false, "visible")).toBe(true);
  });
});

describe("projectionRecoveryDelay", () => {
  it("backs off failed projection recovery without retrying forever", () => {
    expect(
      Array.from({ length: 7 }, (_, attempt) =>
        projectionRecoveryDelay(attempt)
      )
    ).toEqual([500, 1_000, 2_000, 4_000, 5_000, null, null]);
  });
});

describe("createSessionHeartbeat", () => {
  it("times out a socket that does not acknowledge its ping", () => {
    vi.useFakeTimers();
    try {
      const sendPing = vi.fn();
      const onTimeout = vi.fn();
      const heartbeat = createSessionHeartbeat({ sendPing, onTimeout });

      heartbeat.start();
      vi.advanceTimersByTime(sessionHeartbeatIntervalMs);
      expect(sendPing).toHaveBeenCalledOnce();
      expect(onTimeout).not.toHaveBeenCalled();

      vi.advanceTimersByTime(sessionHeartbeatTimeoutMs);
      expect(onTimeout).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rearms after a pong and cancels pending work when stopped", () => {
    vi.useFakeTimers();
    try {
      const sendPing = vi.fn();
      const onTimeout = vi.fn();
      const heartbeat = createSessionHeartbeat({ sendPing, onTimeout });

      heartbeat.start();
      vi.advanceTimersByTime(sessionHeartbeatIntervalMs);
      heartbeat.acknowledge();
      vi.advanceTimersByTime(sessionHeartbeatTimeoutMs);
      expect(onTimeout).not.toHaveBeenCalled();

      heartbeat.stop();
      vi.runOnlyPendingTimers();
      expect(sendPing).toHaveBeenCalledOnce();
      expect(onTimeout).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("parseSessionSocketMessage", () => {
  const event = {
    sessionId: "session-1",
    projectionEpoch: epoch,
    sequence: 3,
    type: "pi.message_end",
    timestamp: "2026-07-27T00:00:00.000Z",
    payload: {}
  };

  it("parses individual and incremental realtime events", () => {
    expect(
      parseSessionSocketMessage(JSON.stringify({ type: "event", event }))
    ).toEqual({ type: "event", event });
    expect(
      parseSessionSocketMessage(
        JSON.stringify({
          type: "sync",
          mode: "incremental",
          events: [event, { ...event, sequence: -1 }]
        })
      )
    ).toEqual({ type: "incremental", events: [event] });
  });

  it("rejects malformed JSON and malformed envelopes", () => {
    expect(parseSessionSocketMessage("{")).toBeNull();
    expect(parseSessionSocketMessage(new ArrayBuffer(0))).toBeNull();
    expect(
      parseSessionSocketMessage(
        JSON.stringify({ type: "event", event: { sequence: 1 } })
      )
    ).toBeNull();
  });

  it("parses websocket synchronization errors", () => {
    expect(
      parseSessionSocketMessage(
        JSON.stringify({ type: "error", message: "sync unavailable" })
      )
    ).toEqual({ type: "error", message: "sync unavailable" });
  });

  it("parses heartbeat acknowledgements", () => {
    expect(
      parseSessionSocketMessage(
        JSON.stringify({ type: "pong", at: 1234 })
      )
    ).toEqual({ type: "pong", at: 1234 });
  });
});
