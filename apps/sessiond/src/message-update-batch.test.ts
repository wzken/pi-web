import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageUpdateBatch } from "./message-update-batch.js";

describe("MessageUpdateBatch", () => {
  afterEach(() => vi.useRealTimers());

  it("delays a burst without dropping any streaming text deltas", () => {
    vi.useFakeTimers();
    const emitted: Record<string, unknown>[] = [];
    const batch = new MessageUpdateBatch((event) => emitted.push(event));

    batch.push({ type: "message_update", delta: { text: "a" } });
    batch.push({ type: "message_update", delta: { text: "b" } });
    batch.push({ type: "message_update", delta: { text: "c" } });

    expect(emitted).toEqual([]);
    vi.advanceTimersByTime(50);
    expect(emitted.map((event) => event.delta)).toEqual([
      { text: "a" },
      { text: "b" },
      { text: "c" }
    ]);
  });

  it("can flush pending deltas before a later non-streaming event", () => {
    vi.useFakeTimers();
    const emitted: string[] = [];
    const batch = new MessageUpdateBatch((event) => {
      emitted.push(String((event.delta as { text?: string }).text));
    });

    batch.push({ delta: { text: "before" } });
    batch.flush();
    emitted.push("settled");
    vi.runAllTimers();

    expect(emitted).toEqual(["before", "settled"]);
  });
});
