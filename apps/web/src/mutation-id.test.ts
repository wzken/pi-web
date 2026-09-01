import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMutationId,
  PendingMutationTracker
} from "./mutation-id";

describe("PendingMutationTracker", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("generates protocol-valid UUIDs", () => {
    expect(createMutationId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it("generates a UUID when randomUUID is unavailable", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => bytes.fill(0)
    });

    expect(createMutationId()).toBe("00000000-0000-4000-8000-000000000000");
  });

  it("reuses an ID until the same payload is confirmed", () => {
    const generateId = vi
      .fn<() => string>()
      .mockReturnValueOnce("mutation-1")
      .mockReturnValueOnce("mutation-2");
    const tracker = new PendingMutationTracker(generateId);
    const payload = { sessionId: "session-1", message: "test" };

    expect(tracker.reserve(payload)).toBe("mutation-1");
    expect(tracker.reserve({ ...payload })).toBe("mutation-1");
    tracker.confirm("mutation-1");
    expect(tracker.reserve(payload)).toBe("mutation-2");
  });

  it("changes IDs when the unconfirmed payload changes", () => {
    const generateId = vi
      .fn<() => string>()
      .mockReturnValueOnce("mutation-1")
      .mockReturnValueOnce("mutation-2");
    const tracker = new PendingMutationTracker(generateId);

    expect(tracker.reserve({ message: "first" })).toBe("mutation-1");
    expect(tracker.reserve({ message: "second" })).toBe("mutation-2");
    tracker.confirm("mutation-1");
    expect(tracker.reserve({ message: "second" })).toBe("mutation-2");
  });
});
