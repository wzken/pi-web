import { describe, expect, it } from "vitest";
import { extractPiTextDelta } from "./index.js";

describe("extractPiTextDelta", () => {
  it("projects visible text deltas", () => {
    expect(
      extractPiTextDelta({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "visible" }
      })
    ).toBe("visible");
    expect(
      extractPiTextDelta({ type: "message_update", delta: { text: "batched" } })
    ).toBe("batched");
  });

  it("never treats thinking or tool-call deltas as answer text", () => {
    expect(
      extractPiTextDelta({ type: "thinking_delta", delta: "private" })
    ).toBe("");
    expect(
      extractPiTextDelta({ type: "toolcall_delta", delta: "{\"path\":" })
    ).toBe("");
  });
});
