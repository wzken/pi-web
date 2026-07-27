import { describe, expect, it } from "vitest";
import {
  extractLastUserPrompt,
  extractRetryablePrompt
} from "./session-messages";

describe("retryable session prompt", () => {
  it("recovers text and supported images only when the user message is last", () => {
    expect(
      extractRetryablePrompt(
        [
          {
            role: "user",
            content: [
              { type: "text", text: "check this" },
              {
                type: "image",
                mimeType: "image/png",
                data: "QQ=="
              }
            ]
          }
        ],
        "interrupted"
      )
    ).toEqual({
      message: "check this",
      images: [
        { type: "image", mimeType: "image/png", data: "QQ==" }
      ]
    });
  });

  it("does not offer a replay after an assistant response or healthy status", () => {
    expect(
      extractRetryablePrompt(
        [
          { role: "user", content: "run tests" },
          { role: "assistant", content: "done" }
        ],
        "failed"
      )
    ).toBeNull();
    expect(
      extractRetryablePrompt(
        [{ role: "user", content: "run tests" }],
        "waiting"
      )
    ).toBeNull();
  });

  it("can explicitly recover the latest user instruction after a response", () => {
    expect(
      extractLastUserPrompt([
        { role: "user", content: "first" },
        { role: "assistant", content: "done" },
        { role: "user", content: "second" },
        { role: "assistant", content: "also done" }
      ])
    ).toEqual({ message: "second", images: [] });
  });
});
