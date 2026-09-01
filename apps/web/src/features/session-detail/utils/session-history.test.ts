import { describe, expect, it } from "vitest";
import { shouldApplyHistoryResponse } from "./session-history";

describe("shouldApplyHistoryResponse", () => {
  const current = {
    requestedSessionId: "session-1",
    activeSessionId: "session-1",
    responseSessionId: "session-1",
    requestedGeneration: 4,
    currentGeneration: 4,
    aborted: false
  };

  it("accepts only the active projection generation", () => {
    expect(shouldApplyHistoryResponse(current)).toBe(true);
    expect(
      shouldApplyHistoryResponse({
        ...current,
        currentGeneration: 5
      })
    ).toBe(false);
  });

  it("rejects aborted, switched-session, and mismatched responses", () => {
    expect(
      shouldApplyHistoryResponse({ ...current, aborted: true })
    ).toBe(false);
    expect(
      shouldApplyHistoryResponse({
        ...current,
        activeSessionId: "session-2"
      })
    ).toBe(false);
    expect(
      shouldApplyHistoryResponse({
        ...current,
        responseSessionId: "session-2"
      })
    ).toBe(false);
  });
});
