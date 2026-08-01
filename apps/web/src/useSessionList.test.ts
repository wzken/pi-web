import { describe, expect, it, vi } from "vitest";
import { invalidateSessionListRequest } from "./useSessionList";

describe("session-list mutation ordering", () => {
  it("invalidates and aborts a refresh before applying a local mutation", () => {
    const abort = vi.fn();
    const generation = { current: 7 };
    const controller = {
      current: { abort } as unknown as AbortController
    };

    invalidateSessionListRequest(generation, controller);

    expect(generation.current).toBe(8);
    expect(abort).toHaveBeenCalledOnce();
    expect(controller.current).toBeNull();
  });
});
