import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  confirmAccessKeyInput,
  readAccessKeyFromStdin,
  stripFinalLineEnding,
  validateAccessKeyInput
} from "./access-key-input.js";

describe("CLI access-key input", () => {
  it("accepts custom passwords without changing meaningful spaces", () => {
    expect(validateAccessKeyInput("  a secure password  ")).toBe(
      "  a secure password  "
    );
  });

  it("rejects short, multiline, and oversized passwords", () => {
    expect(() => validateAccessKeyInput("short")).toThrow(
      "at least 8 characters"
    );
    expect(() => validateAccessKeyInput("password\nsecond")).toThrow(
      "line-break"
    );
    expect(() => validateAccessKeyInput("x".repeat(1025))).toThrow(
      "at most 1024 characters"
    );
  });

  it("requires interactive confirmation to match", () => {
    expect(confirmAccessKeyInput("password-1", "password-1")).toBe("password-1");
    expect(() => confirmAccessKeyInput("password-1", "password-2")).toThrow(
      "did not match"
    );
  });

  it("removes only one final line ending from stdin", async () => {
    expect(stripFinalLineEnding("password-1\r\n")).toBe("password-1");
    expect(stripFinalLineEnding("password-1\n\n")).toBe("password-1\n");
    await expect(
      readAccessKeyFromStdin(Readable.from(["password-1\r\n"]))
    ).resolves.toBe("password-1");
    await expect(
      readAccessKeyFromStdin(Readable.from(["password-1\n\n"]))
    ).rejects.toThrow("line-break");
  });
});
