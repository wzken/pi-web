import { describe, expect, it } from "vitest";
import {
  createSessionSchema,
  maxPromptImagesTotalBytes,
  maxPromptRequestBytes,
  promptSchema,
  resumeSessionSchema
} from "./index.js";

const image = {
  type: "image" as const,
  mimeType: "image/png" as const,
  data: "QQ=="
};

describe("prompt image validation", () => {
  it("reserves enough transport space for the maximum encoded payload", () => {
    expect(maxPromptRequestBytes).toBeGreaterThan(
      Math.ceil((maxPromptImagesTotalBytes * 4) / 3)
    );
  });

  it("accepts image-only prompts for new and existing sessions", () => {
    expect(promptSchema.parse({ images: [image] }).message).toBe("");
    expect(
      createSessionSchema.parse({
        cwd: "C:/repo",
        displayName: "Screenshot",
        images: [image]
      }).images
    ).toEqual([image]);
  });

  it("keeps an empty resume valid but rejects an empty message submission", () => {
    expect(resumeSessionSchema.parse({}).images).toEqual([]);
    expect(() => promptSchema.parse({ message: "   " })).toThrow();
  });

  it("rejects unsupported image types and excessive counts", () => {
    expect(() =>
      promptSchema.parse({
        images: [{ ...image, mimeType: "image/svg+xml" }]
      })
    ).toThrow();
    expect(() =>
      promptSchema.parse({ images: Array.from({ length: 17 }, () => image) })
    ).toThrow();
  });
});
