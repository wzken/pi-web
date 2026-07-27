import { describe, expect, it } from "vitest";
import {
  formatBytes,
  formatElapsed,
  safeFileName
} from "./session-formatting";

describe("session formatting", () => {
  it("formats file sizes at stable unit boundaries", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1_536)).toBe("1.5 KB");
    expect(formatBytes(2 * 1024 * 1024)).toBe("2.0 MB");
  });

  it("sanitizes exported snapshot names", () => {
    expect(safeFileName('  demo: "session" / one  ')).toBe(
      "demo- -session- - one"
    );
    expect(safeFileName("")).toBe("pi-session");
  });

  it("formats elapsed time and rejects invalid timestamps", () => {
    expect(
      formatElapsed(
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T01:02:03.000Z",
        0
      )
    ).toBe("1h 2m");
    expect(formatElapsed("invalid", null, 0)).toBe("—");
  });
});
