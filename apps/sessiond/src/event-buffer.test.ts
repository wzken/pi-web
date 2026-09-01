import { describe, expect, it } from "vitest";
import type { RealtimeEvent } from "@pi-web/protocol";
import { SessionEventBuffer } from "./event-buffer.js";

function event(sequence: number, sessionId = "session", text = ""): RealtimeEvent {
  return {
    sessionId,
    projectionEpoch: "11111111-1111-4111-8111-111111111111",
    sequence,
    type: "pi.message_update",
    timestamp: new Date().toISOString(),
    payload: { sequence, text }
  };
}

describe("SessionEventBuffer", () => {
  it("retains the latest sequence after older replay data expires", () => {
    const buffer = new SessionEventBuffer(3);
    for (let sequence = 1; sequence <= 6; sequence += 1) {
      buffer.append(event(sequence));
    }
    expect(buffer.replay("session", 0).available).toBe(false);
    expect(buffer.latestSequence("session")).toBe(6);
    expect(buffer.replay("session", 4).events.map((item) => item.sequence)).toEqual([
      5,
      6
    ]);
  });

  it("bounds retained sessions with least-recently-appended eviction", () => {
    const buffer = new SessionEventBuffer(3, 2);
    buffer.append(event(1, "first"));
    buffer.append(event(1, "second"));
    buffer.append(event(2, "first"));
    const eviction = buffer.append(event(1, "third"));

    expect(eviction).toEqual({ sessionId: "second", latestSequence: 1 });
    expect(buffer.replay("second", 0)).toEqual({
      available: true,
      events: []
    });
    expect(buffer.latestSequence("first")).toBe(2);
    expect(buffer.latestSequence("third")).toBe(1);
  });

  it("expires old replay data when the per-session byte budget is reached", () => {
    const buffer = new SessionEventBuffer(100, 2, 500);
    buffer.append(event(1, "session", "a".repeat(300)));
    buffer.append(event(2, "session", "b".repeat(300)));

    expect(buffer.latestSequence("session")).toBe(2);
    expect(buffer.replay("session", 0).available).toBe(false);
    expect(buffer.replay("session", 1).events.map((item) => item.sequence)).toEqual([
      2
    ]);
  });

  it("retains sequence authority without retaining one oversized event", () => {
    const buffer = new SessionEventBuffer(100, 2, 100);
    buffer.append(event(7, "session", "x".repeat(1_000)));

    expect(buffer.latestSequence("session")).toBe(7);
    expect(buffer.replay("session", 6).available).toBe(false);
    expect(buffer.replay("session", 7)).toEqual({
      available: true,
      events: []
    });
  });
});
