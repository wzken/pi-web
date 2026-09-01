import { describe, expect, it } from "vitest";
import {
  compareSemver,
  extractPiVersion,
  minimumPiVersion,
  requiredPiRpcCommands
} from "./pi-compatibility.js";

describe("Pi compatibility kernel", () => {
  it("locks the supported baseline and required RPC surface", () => {
    expect(minimumPiVersion).toBe("0.84.1");
    expect(requiredPiRpcCommands).toEqual([
      "get_state",
      "get_available_models",
      "get_available_thinking_levels",
      "get_commands",
      "get_entries",
      "get_tree"
    ]);
  });

  it("extracts release and prerelease versions from Pi output", () => {
    expect(extractPiVersion("Pi Coding Agent 0.84.1\n")).toBe("0.84.1");
    expect(extractPiVersion("pi 0.85.0-beta.2+build")).toBe("0.85.0");
    expect(extractPiVersion("unknown")).toBeNull();
  });

  it("compares semantic version triplets deterministically", () => {
    expect(compareSemver("0.84.1", "0.84.1")).toBe(0);
    expect(compareSemver("0.84.2", "0.84.1")).toBeGreaterThan(0);
    expect(compareSemver("0.83.9", "0.84.1")).toBeLessThan(0);
    expect(compareSemver("1.0.0", "0.99.99")).toBeGreaterThan(0);
  });
});
