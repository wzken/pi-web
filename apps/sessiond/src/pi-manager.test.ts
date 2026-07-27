import { describe, expect, it } from "vitest";
import {
  parseModels,
  parsePackageList,
  validatePackageSource
} from "./pi-manager.js";

describe("Pi package argv validation", () => {
  it("allows documented sources and rejects shell-like input", () => {
    expect(validatePackageSource("npm:@foo/bar@1.0.0")).toBe(
      "npm:@foo/bar@1.0.0"
    );
    expect(validatePackageSource("git:github.com/user/repo@v1")).toContain(
      "github.com"
    );
    expect(() => validatePackageSource("foo; rm -rf /")).toThrow();
    expect(() => validatePackageSource("npm:foo\n--bad")).toThrow();
  });

  it("parses Pi 0.82 model-table and scoped package-list output", () => {
    expect(
      parseModels(
        [
          "provider  model                       context  max-out  thinking  images",
          "anthropic  claude-sonnet-4-5-20250929  200K     64K      yes       yes",
          "openai     gpt-5.2-codex               400K     128K     yes       yes"
        ].join("\n")
      )
    ).toMatchObject([
      { provider: "anthropic", id: "claude-sonnet-4-5-20250929" },
      { provider: "openai", id: "gpt-5.2-codex" }
    ]);
    expect(
      parsePackageList(
        [
          "User packages:",
          "  npm:@trusted/pi-tools@1.2.3",
          "    /home/user/.pi/agent/git/example",
          "",
          "Project packages:",
          "  git:github.com/example/pi-extra@v1 (filtered)",
          "    /project/.pi/git/example"
        ].join("\n")
      )
    ).toEqual([
      "npm:@trusted/pi-tools@1.2.3",
      "git:github.com/example/pi-extra@v1"
    ]);
  });
});
