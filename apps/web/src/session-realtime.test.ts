import { describe, expect, it } from "vitest";
import {
  isNewerSequence,
  parseSessionSocketMessage,
  resolveAfterSequence
} from "./session-realtime";

describe("resolveAfterSequence", () => {
  it("uses a valid stored sequence without moving backwards", () => {
    expect(resolveAfterSequence("12", 8)).toBe(12);
    expect(resolveAfterSequence("4", 8)).toBe(8);
  });

  it("ignores corrupt or unsafe browser storage values", () => {
    expect(resolveAfterSequence("not-a-number", 7)).toBe(7);
    expect(resolveAfterSequence("-1", 7)).toBe(7);
    expect(resolveAfterSequence("1.5", 7)).toBe(7);
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

describe("parseSessionSocketMessage", () => {
  const event = {
    sessionId: "session-1",
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
});
