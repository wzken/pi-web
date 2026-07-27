import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearDraft, readDraft, writeDraft } from "./draft-store";

describe("draft store", () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    values.clear();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key)
      }
    });
  });

  it("keeps drafts isolated by scope", () => {
    writeDraft("new:C:/repo-a", "task a");
    writeDraft("session:123", "follow up");

    expect(readDraft("new:C:/repo-a")).toBe("task a");
    expect(readDraft("session:123")).toBe("follow up");
  });

  it("removes empty and cleared drafts", () => {
    writeDraft("session:123", "temporary");
    clearDraft("session:123");

    expect(readDraft("session:123")).toBe("");
  });
});
