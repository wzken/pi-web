import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageUpdateBatch } from "./message-update-batch.js";

describe("MessageUpdateBatch", () => {
  afterEach(() => vi.useRealTimers());

  it("coalesces a burst without dropping any streaming text deltas", () => {
    vi.useFakeTimers();
    const emitted: Record<string, unknown>[] = [];
    const batch = new MessageUpdateBatch((event) => emitted.push(event));

    batch.push("a");
    batch.push("b");
    batch.push("c");

    expect(emitted).toEqual([]);
    vi.advanceTimersByTime(50);
    expect(emitted.map((event) => event.delta)).toEqual([{ text: "abc" }]);
  });

  it("can flush pending deltas before a later non-streaming event", () => {
    vi.useFakeTimers();
    const emitted: string[] = [];
    const batch = new MessageUpdateBatch((event) => {
      emitted.push(String((event.delta as { text?: string }).text));
    });

    batch.push("before");
    batch.flush();
    emitted.push("settled");
    vi.runAllTimers();

    expect(emitted).toEqual(["before", "settled"]);
  });

  it("bounds a synchronous burst before the timer can run", () => {
    vi.useFakeTimers();
    const emitted: string[] = [];
    const batch = new MessageUpdateBatch((event) => {
      emitted.push(String((event.delta as { text?: string }).text));
    });
    const text = "x".repeat(MessageUpdateBatch.maxTextCharacters + 5);

    batch.push(text);
    expect(emitted).toEqual([
      "x".repeat(MessageUpdateBatch.maxTextCharacters)
    ]);
    vi.advanceTimersByTime(50);
    expect(emitted.join("")).toBe(text);
  });
});
