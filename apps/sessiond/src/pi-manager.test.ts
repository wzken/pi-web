import { stat } from "node:fs/promises";
import type { PiWebConfig } from "@pi-web/config";
import { describe, expect, it, vi } from "vitest";
import type { SessionDatabase } from "./database.js";
import {
  PiManager,
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
    expect(validatePackageSource("ssh://git@github.com/user/repo@v1")).toBe(
      "ssh://git@github.com/user/repo@v1"
    );
    expect(() => validatePackageSource("foo; rm -rf /")).toThrow();
    expect(() => validatePackageSource("npm:foo\n--bad")).toThrow();
  });

  it("parses Pi 0.82 model-table and only user-scoped packages", () => {
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
    ).toEqual(["npm:@trusted/pi-tools@1.2.3"]);
    expect(
      parsePackageList(
        [
          "Project packages:",
          "  npm:@project/only@1.0.0",
          "    /project/.pi/git/example"
        ].join("\n")
      )
    ).toEqual([]);
  });

  it("runs global model and package commands from disposable non-project cwd", async () => {
    const calls: Array<{ args: string[]; cwd: string | undefined }> = [];
    const audit = vi.fn();
    const manager = new PiManager(
      { piExecutable: "pi" } as PiWebConfig,
      { audit } as unknown as SessionDatabase,
      async (_executable, args, options) => {
        calls.push({ args, cwd: options.cwd });
        return {
          stdout:
            args[0] === "list"
              ? "User packages:\n  npm:user-package@1.0.0"
              : "",
          stderr: ""
        };
      }
    );

    await manager.status();
    await manager.packageOperation({
      action: "remove",
      source: "npm:user-package@1.0.0"
    });
    await manager.packageOperation({ action: "update_all" });

    const globalCalls = calls.filter(({ args }) =>
      ["--list-models", "list", "remove", "update"].includes(args[0] ?? "")
    );
    expect(globalCalls.map(({ args }) => args)).toHaveLength(4);
    expect(globalCalls.map(({ args }) => args)).toEqual(
      expect.arrayContaining([
        ["list"],
        ["--list-models"],
        ["remove", "npm:user-package@1.0.0"],
        ["update", "--extensions"]
      ])
    );
    for (const call of globalCalls) {
      expect(call.cwd).toMatch(/pi-web-global-scope-/);
      expect(
        await stat(call.cwd ?? "").then(
          () => true,
          () => false
        )
      ).toBe(false);
    }
    expect(audit).toHaveBeenCalledTimes(2);
  });
});
