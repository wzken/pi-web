import { describe, expect, it } from "vitest";
import {
  generateAccessKey,
  hashAccessKey,
  verifyAccessKey
} from "./auth.js";

describe("access keys", () => {
  it("generates at least 32 random bytes and verifies with scrypt", async () => {
    const key = generateAccessKey();
    expect(Buffer.from(key, "base64url").byteLength).toBeGreaterThanOrEqual(32);
    const stored = await hashAccessKey(key);
    expect(await verifyAccessKey(key, stored)).toBe(true);
    expect(await verifyAccessKey(`${key}x`, stored)).toBe(false);
  });
});
