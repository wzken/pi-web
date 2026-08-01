import { describe, expect, it } from "vitest";
import {
  createSessionSchema,
  promptSchema,
  resumeSessionSchema
} from "./index.js";

const mutationId = "4b650b13-d818-4931-b193-c2da51c2b27b";

describe("mutation ID validation", () => {
  it("accepts UUID mutation IDs without breaking legacy callers", () => {
    expect(
      createSessionSchema.parse({
        mutationId,
        cwd: "/workspace",
        displayName: "Create",
        images: []
      }).mutationId
    ).toBe(mutationId);
    expect(
      promptSchema.parse({
        mutationId,
        message: "Prompt",
        images: []
      }).mutationId
    ).toBe(mutationId);
    expect(
      resumeSessionSchema.parse({ mutationId }).mutationId
    ).toBe(mutationId);
    expect(resumeSessionSchema.parse({}).mutationId).toBeUndefined();
  });

  it("rejects non-UUID mutation IDs", () => {
    expect(() =>
      promptSchema.parse({
        mutationId: "retry-me",
        message: "Prompt"
      })
    ).toThrow();
  });
});
