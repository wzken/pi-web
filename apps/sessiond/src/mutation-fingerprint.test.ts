import { describe, expect, it } from "vitest";
import { fingerprintMutationPayload } from "./mutation-fingerprint.js";

describe("fingerprintMutationPayload", () => {
  it("is stable across object key order and changes with payload content", () => {
    const first = fingerprintMutationPayload({
      message: "hello",
      images: [{ data: "QQ==", mimeType: "image/png" }]
    });
    const reordered = fingerprintMutationPayload({
      images: [{ mimeType: "image/png", data: "QQ==" }],
      message: "hello"
    });
    const changed = fingerprintMutationPayload({
      images: [{ mimeType: "image/png", data: "Qg==" }],
      message: "hello"
    });

    expect(reordered).toBe(first);
    expect(changed).not.toBe(first);
  });
});
