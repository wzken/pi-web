import { describe, expect, it } from "vitest";
import { PiSessionCursorError } from "@pi-web/pi-session-reader";
import { PiWebError } from "@pi-web/shared";
import {
  cursorHistoryReadError,
  isUnsupportedPiCommand,
  messagesFromGetMessagesResponse,
  runtimeGenerationIsCurrent,
  runtimeHistoryFallbackAllowed,
  snapshotHistoryError,
  usageFromSessionStats
} from "./supervisor.js";

describe("usageFromSessionStats", () => {
  it("projects Pi RPC session statistics without inventing usage", () => {
    expect(
      usageFromSessionStats({
        toolCalls: 12,
        tokens: {
          input: 50_000,
          output: 10_000,
          cacheRead: 40_000,
          cacheWrite: 5_000,
          total: 105_000
        },
        cost: 0.45
      })
    ).toEqual({
      inputTokens: 50_000,
      outputTokens: 10_000,
      cachedTokens: 40_000,
      reportedCost: 0.45,
      estimatedCost: null,
      costStatus: "reported",
      toolCalls: 12
    });
  });

  it("refuses partial or invalid statistics", () => {
    expect(
      usageFromSessionStats({
        toolCalls: 1,
        tokens: { input: 10, output: 2 }
      })
    ).toBeNull();
    expect(
      usageFromSessionStats({
        toolCalls: -1,
        tokens: { input: 10, output: 2, cacheRead: 0 }
      })
    ).toBeNull();
  });
});

describe("snapshot response boundaries", () => {
  it("rejects a non-array get_messages payload instead of hiding it", () => {
    expect(() =>
      messagesFromGetMessagesResponse({ messages: { role: "assistant" } })
    ).toThrowError(
      expect.objectContaining({
        code: "PI_RPC_INVALID_RESPONSE",
        statusCode: 502
      })
    );
    expect(messagesFromGetMessagesResponse({ messages: [] })).toEqual([]);
  });

  it("maps stale cursors to 409 and other paged read failures to 503", () => {
    expect(
      cursorHistoryReadError(new PiSessionCursorError("signature changed"))
    ).toMatchObject({
      code: "PI_SESSION_CURSOR_STALE",
      statusCode: 409
    });
    expect(cursorHistoryReadError(new Error("disk unavailable"))).toMatchObject({
      code: "PI_SESSION_PAGE_UNAVAILABLE",
      statusCode: 503
    });
    expect(runtimeHistoryFallbackAllowed()).toBe(true);
    expect(runtimeHistoryFallbackAllowed(null)).toBe(true);
    expect(runtimeHistoryFallbackAllowed("opaque-cursor")).toBe(false);
  });

  it("preserves both the history and RPC fallback errors", () => {
    const error = snapshotHistoryError(
      new Error("JSONL parse failed"),
      new Error("get_messages timed out")
    );
    expect(error).toMatchObject({
      code: "PI_SESSION_READ_FAILED",
      statusCode: 503,
      details: {
        historyError: "JSONL parse failed",
        fallbackError: "get_messages timed out"
      }
    });
    expect(error.message).toContain("JSONL parse failed");
    expect(error.message).toContain("get_messages timed out");
  });

  it("only treats an explicit unsupported-command rejection as optional", () => {
    expect(
      isUnsupportedPiCommand(
        new PiWebError(
          "PI_RPC_REJECTED",
          "Unknown command: get_session_stats",
          422
        )
      )
    ).toBe(true);
    expect(
      isUnsupportedPiCommand(
        new PiWebError("PI_RPC_TIMEOUT", "get_session_stats timed out", 504)
      )
    ).toBe(false);
    expect(
      isUnsupportedPiCommand(
        new PiWebError("PI_RPC_REJECTED", "permission denied", 422)
      )
    ).toBe(false);
  });

  it("rejects settle work from a replaced runtime or an older activity", () => {
    const originalRuntime = {};
    const replacementRuntime = {};
    expect(
      runtimeGenerationIsCurrent(originalRuntime, originalRuntime, 4, 4)
    ).toBe(true);
    expect(
      runtimeGenerationIsCurrent(replacementRuntime, originalRuntime, 4, 4)
    ).toBe(false);
    expect(
      runtimeGenerationIsCurrent(originalRuntime, originalRuntime, 5, 4)
    ).toBe(false);
  });
});
