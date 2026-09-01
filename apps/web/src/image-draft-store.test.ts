import { describe, expect, it } from "vitest";
import {
  clearImageDraft,
  readImageDraft,
  writeImageDraft
} from "./image-draft-store";

describe("image attachment draft fallback", () => {
  it("remains usable when IndexedDB is unavailable", async () => {
    await expect(readImageDraft("session:test")).resolves.toEqual([]);
    await expect(
      writeImageDraft("session:test", [
        {
          id: "one",
          name: "screen.png",
          size: 1,
          type: "image",
          mimeType: "image/png",
          data: "QQ=="
        }
      ])
    ).resolves.toBeUndefined();
    await expect(clearImageDraft("session:test")).resolves.toBeUndefined();
  });
});
