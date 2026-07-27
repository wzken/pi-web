import { describe, expect, it } from "vitest";
import type { RealtimeEvent } from "@pi-web/protocol";
import { SessionEventBuffer } from "./event-buffer.js";

function event(sequence: number): RealtimeEvent {
  return {
    sessionId: "session",
    sequence,
    type: "pi.message_update",
    timestamp: new Date().toISOString(),
    payload: { sequence }
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
});
