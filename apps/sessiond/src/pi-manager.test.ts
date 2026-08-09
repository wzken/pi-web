import { stat } from "node:fs/promises";
import type { PiWebConfig } from "@pi-web/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionDatabase } from "./database.js";
import {
  PiManager,
  parseModels,
  parsePackageList,
  validatePackageSource
} from "./pi-manager.js";

afterEach(() => vi.unstubAllEnvs());

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
    vi.stubEnv("PI_WEB_ACCESS_KEY", "must-not-reach-pi");
    const calls: Array<{
      args: string[];
      cwd: string | undefined;
      env: NodeJS.ProcessEnv;
    }> = [];
    const audit = vi.fn();
    const manager = new PiManager(
      { piExecutable: "pi" } as PiWebConfig,
      { audit } as unknown as SessionDatabase,
      async (_executable, args, options) => {
        calls.push({ args, cwd: options.cwd, env: options.env });
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
      expect(call.env.PI_WEB_ACCESS_KEY).toBeUndefined();
      expect(
        await stat(call.cwd ?? "").then(
          () => true,
          () => false
        )
      ).toBe(false);
    }
    expect(audit).toHaveBeenCalledTimes(2);
  });

  it("checks the official Pi release endpoint and caches the reminder", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({ version: "0.84.1", note: "New release" }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    ) as unknown as typeof fetch;
    const manager = new PiManager(
      { piExecutable: "pi" } as PiWebConfig,
      { audit: vi.fn() } as unknown as SessionDatabase,
      async () => ({ stdout: "Pi Coding Agent 0.82.0\n", stderr: "" }),
      fetcher
    );

    await expect(manager.updateStatus()).resolves.toMatchObject({
      currentVersion: "0.82.0",
      latestVersion: "0.84.1",
      updateAvailable: true,
      changelogUrl: "https://pi.dev/changelog",
      error: null
    });
    await manager.updateStatus();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      "https://pi.dev/api/latest-version",
      expect.objectContaining({ headers: { accept: "application/json" } })
    );

    await manager.updateStatus(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
