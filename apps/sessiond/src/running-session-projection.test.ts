import { afterEach, describe, expect, it, vi } from "vitest";
import type { RealtimeEvent } from "@pi-web/protocol";
import { RunningSessionProjection } from "./running-session-projection.js";

describe("RunningSessionProjection", () => {
  afterEach(() => vi.useRealTimers());

  it("flushes message updates before projecting a later Pi event", () => {
    vi.useFakeTimers();
    const emitted: string[] = [];
    let sequence = 0;
    const projection = new RunningSessionProjection({
      emitMessageUpdate: () => emitted.push("pi.message_update"),
      emitPiEvent: (type) => {
        emitted.push(`pi.${type}`);
        return realtimeEvent(++sequence, `pi.${type}`);
      }
    });

    expect(projection.ingest({ type: "message_update", delta: "a" })).toBeNull();
    expect(emitted).toEqual([]);

    expect(
      projection.ingest({
        type: "queue_update",
        steering: ["one", 2],
        followUp: ["later", null]
      })
    ).toBe("queue_update");

    expect(emitted).toEqual(["pi.message_update", "pi.queue_update"]);
    expect(projection.snapshot().queuedMessages).toEqual({
      steering: ["one"],
      followUp: ["later"]
    });
  });

  it("rebuilds in-flight text and clears it at Pi message boundaries", () => {
    const projection = new RunningSessionProjection({
      emitMessageUpdate: () => undefined,
      emitPiEvent: (type) => realtimeEvent(1, `pi.${type}`)
    });

    projection.ingest({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "hello" }
    });
    projection.ingest({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: " world" }
    });
    expect(projection.snapshot().liveText).toBe("hello world");

    projection.ingest({ type: "message_end", message: {} });
    expect(projection.snapshot().liveText).toBe("");
  });

  it("assigns pending text a sequence before exposing it in a snapshot", () => {
    vi.useFakeTimers();
    let sequence = 0;
    const projection = new RunningSessionProjection({
      emitMessageUpdate: () => {
        sequence += 1;
      },
      emitPiEvent: (type) => realtimeEvent(++sequence, `pi.${type}`)
    });

    projection.ingest({ type: "message_update", delta: "hello" });
    expect(sequence).toBe(0);

    expect(projection.synchronizedSnapshot().liveText).toBe("hello");
    expect(sequence).toBe(1);
    vi.advanceTimersByTime(50);
    expect(sequence).toBe(1);
  });

  it("does not project Pi thinking or tool-call deltas as answer text", () => {
    const emitted: Record<string, unknown>[] = [];
    const projection = new RunningSessionProjection({
      emitMessageUpdate: (event) => emitted.push(event),
      emitPiEvent: (type) => realtimeEvent(1, `pi.${type}`)
    });

    projection.ingest({
      type: "message_update",
      assistantMessageEvent: { type: "thinking_delta", delta: "secret" }
    });
    projection.ingest({
      type: "message_update",
      assistantMessageEvent: { type: "toolcall_delta", delta: "{\"path\":" }
    });
    projection.flush();

    expect(projection.snapshot().liveText).toBe("");
    expect(emitted).toEqual([]);
  });

  it("keeps only the latest tool events in its reconnect projection", () => {
    let sequence = 0;
    const projection = new RunningSessionProjection({
      emitMessageUpdate: () => undefined,
      emitPiEvent: (type, payload) => ({
        ...realtimeEvent(++sequence, `pi.${type}`),
        payload
      })
    });

    for (let index = 0; index < 55; index += 1) {
      projection.ingest({
        type: "tool_execution_update",
        toolCallId: `call-${index}`
      });
    }

    const snapshot = projection.synchronizedSnapshot();
    expect(snapshot.recentToolEvents).toHaveLength(50);
    expect(
      (snapshot.recentToolEvents[0]?.payload as Record<string, unknown>)
        .toolCallId
    ).toBe("call-5");
    expect(
      (snapshot.recentToolEvents.at(-1)?.payload as Record<string, unknown>)
        .toolCallId
    ).toBe("call-54");
    expect(sequence).toBe(50);

    snapshot.recentToolEvents.length = 0;
    snapshot.queuedMessages.steering.push("mutated");
    expect(projection.snapshot()).toMatchObject({
      recentToolEvents: expect.any(Array),
      liveText: "",
      queuedMessages: { steering: [], followUp: [] }
    });
    expect(projection.snapshot().recentToolEvents).toHaveLength(50);
  });

  it("keeps a ten-thousand-update tool storm as one bounded snapshot record", () => {
    let sequence = 0;
    const projection = new RunningSessionProjection({
      emitMessageUpdate: () => undefined,
      emitPiEvent: (type, payload) => ({
        ...realtimeEvent(++sequence, `pi.${type}`),
        payload
      })
    });

    projection.ingest({
      type: "tool_execution_start",
      toolCallId: "storm",
      toolName: "shell"
    });
    for (let index = 0; index < 10_000; index += 1) {
      projection.ingest({
        type: "tool_execution_update",
        toolCallId: "storm",
        toolName: "shell",
        partialResult: `chunk-${index}-${"x".repeat(10_000)}`
      });
    }

    const snapshot = projection.synchronizedSnapshot();
    expect(snapshot.recentToolEvents).toHaveLength(1);
    const payload = snapshot.recentToolEvents[0]?.payload as Record<
      string,
      unknown
    >;
    expect(payload.toolCallId).toBe("storm");
    expect(String(payload.outputPreview)).toHaveLength(8_192);
    expect(String(payload.outputPreview)).toContain("chunk-9999");
    expect(sequence).toBe(2);
  });

  it("emits only a compact, bounded projection of transient Pi events", () => {
    let emittedPayload: Record<string, unknown> | null = null;
    const projection = new RunningSessionProjection({
      emitMessageUpdate: () => undefined,
      emitPiEvent: (type, payload) => {
        emittedPayload = payload;
        return {
          ...realtimeEvent(1, `pi.${type}`),
          payload
        };
      }
    });

    projection.ingest({
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: "read",
      isError: false,
      result: "x".repeat(5_000_000),
      partialResult: { secret: "must not be retained" }
    });

    expect(emittedPayload).toMatchObject({
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: "read",
      status: "done",
      isError: false,
      outputPreview: "x".repeat(8_192)
    });
    expect(
      JSON.stringify(projection.snapshot().recentToolEvents)
    ).not.toContain("must not be retained");
  });

  it("merges tool lifecycle events by call id and clears them when the agent settles", () => {
    let sequence = 0;
    const projection = new RunningSessionProjection({
      emitMessageUpdate: () => undefined,
      emitPiEvent: (type, payload) => ({
        ...realtimeEvent(++sequence, `pi.${type}`),
        payload
      })
    });

    projection.ingest({
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "read"
    });
    projection.ingest({
      type: "tool_execution_update",
      toolCallId: "call-1",
      toolName: "read",
      partialResult: "reading"
    });
    projection.ingest({
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: "read",
      result: "done",
      isError: false
    });

    expect(projection.snapshot().recentToolEvents).toHaveLength(1);
    expect(projection.snapshot().recentToolEvents[0]).toMatchObject({
      payload: {
        toolCallId: "call-1",
        status: "done",
        outputPreview: "done"
      }
    });

    projection.ingest({ type: "agent_settled" });
    expect(projection.snapshot().recentToolEvents).toEqual([]);
  });

  it("bounds queued-message previews before retaining and emitting them", () => {
    let emittedPayload: Record<string, unknown> | null = null;
    const projection = new RunningSessionProjection({
      emitMessageUpdate: () => undefined,
      emitPiEvent: (type, payload) => {
        emittedPayload = payload;
        return {
          ...realtimeEvent(1, `pi.${type}`),
          payload
        };
      }
    });

    projection.ingest({
      type: "queue_update",
      steering: Array.from({ length: 150 }, () => "x".repeat(20_000)),
      followUp: []
    });

    expect(projection.snapshot().queuedMessages.steering).toHaveLength(16);
    expect(
      projection.snapshot().queuedMessages.steering.reduce(
        (total, item) => total + item.length,
        0
      )
    ).toBe(256 * 1024);
    expect(emittedPayload).toMatchObject({
      type: "queue_update",
      steering: expect.any(Array),
      followUp: []
    });
  });
});

function realtimeEvent(sequence: number, type: string): RealtimeEvent {
  return {
    sessionId: "session",
    projectionEpoch: "11111111-1111-4111-8111-111111111111",
    sequence,
    type,
    timestamp: new Date().toISOString(),
    payload: {}
  };
}
