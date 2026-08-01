import { describe, expect, it } from "vitest";
import { isCacheFresh } from "./cache-policy";

describe("isCacheFresh", () => {
  it("bounds cached data by its TTL", () => {
    expect(isCacheFresh(null, 10_000, 30_000)).toBe(false);
    expect(isCacheFresh(1_000, 30_999, 30_000)).toBe(true);
    expect(isCacheFresh(1_000, 31_000, 30_000)).toBe(false);
    expect(isCacheFresh(2_000, 1_000, 30_000)).toBe(false);
  });
});
