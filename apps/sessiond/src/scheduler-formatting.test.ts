import { describe, expect, it } from "vitest";
import { scheduledSessionDisplayName } from "./scheduler.js";

describe("scheduledSessionDisplayName", () => {
  it("uses a deterministic UTC timestamp", () => {
    expect(
      scheduledSessionDisplayName("Nightly review", "2026-07-27T01:02:03.000Z")
    ).toBe("Nightly review · 2026-07-27 01:02Z");
  });

  it("preserves an invalid source value for diagnostics", () => {
    expect(scheduledSessionDisplayName("Review", "invalid")).toBe(
      "Review · invalid"
    );
  });
});
