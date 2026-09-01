import { EventEmitter } from "node:events";
import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { activateInstallation, isDirectExecution } from "./index.js";
import {
  runCombined,
  sessiondEnvironment,
  type CombinedChildProcess,
  type CombinedRuntimeDependencies
} from "./combined-runtime.js";

describe("CLI entrypoint", () => {
  it("recognizes a symlinked executable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-web-cli-entry-"));
    const target = join(directory, "index.mjs");
    const link = join(directory, "pi-web.mjs");
    await writeFile(target, "export {};\n", "utf8");
    await symlink(target, link, "file");

    expect(isDirectExecution(pathToFileURL(target).href, link)).toBe(true);
  });
});

describe("sessiond environment", () => {
  it("filters sensitive keys case-insensitively", () => {
    expect(
      sessiondEnvironment({
        Path: "preserved",
        pi_web_access_key: "secret",
        Pi_Web_Scheduler_Socket: "stale-socket",
        PI_WEB_SCHEDULER_TOKEN: "stale-token",
        pi_web_session_id: "stale-session"
      })
    ).toEqual({ Path: "preserved" });
  });
});

class FakeChild extends EventEmitter implements CombinedChildProcess {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly killSignals: Array<NodeJS.Signals | number> = [];

  constructor(private readonly exitWhenKilled = false) {
    super();
  }

  kill(signal: NodeJS.Signals | number = "SIGTERM"): boolean {
    this.killSignals.push(signal);
    if (this.exitWhenKilled) {
      this.finish(
        null,
        typeof signal === "string" ? signal : "SIGTERM"
      );
    }
    return true;
  }

  finish(code: number | null, signal: NodeJS.Signals | null = null): void {
    if (this.exitCode !== null || this.signalCode !== null) return;
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("exit", code, signal);
  }

  failToSpawn(error: Error): void {
    this.emit("error", error);
  }
}

describe("combined CLI runtime", () => {
  it("propagates a child failure and waits for the other child to exit", async () => {
    const sessiond = new FakeChild();
    const server = new FakeChild();
    const spawnService = vi.fn((service: "sessiond" | "server") =>
      service === "sessiond" ? sessiond : server
    );
    const dependencies = createDependencies(spawnService, async () => undefined);
    const runtime = runCombined(dependencies);
    let settled = false;
    void runtime
      .finally(() => {
        settled = true;
      })
      .catch(() => undefined);
    await vi.waitFor(() => expect(spawnService).toHaveBeenCalledTimes(2));

    server.finish(7);
    await vi.waitFor(() =>
      expect(sessiond.killSignals).toContain("SIGTERM")
    );
    expect(settled).toBe(false);

    sessiond.finish(null, "SIGTERM");
    await expect(runtime).rejects.toThrow("server exited with code 7");
    expect(settled).toBe(true);
    expect(dependencies.removeSignalListener).toHaveBeenCalledTimes(2);
  });

  it("cleans up sessiond when readiness fails before server startup", async () => {
    const readinessError = new Error("socket never became ready");
    const sessiond = new FakeChild(true);
    const spawnService = vi.fn(() => sessiond);
    const dependencies = createDependencies(spawnService, async () => {
      throw readinessError;
    });

    await expect(runCombined(dependencies)).rejects.toBe(readinessError);
    expect(spawnService).toHaveBeenCalledOnce();
    expect(sessiond.killSignals).toContain("SIGTERM");
  });

  it("treats an unexpected clean child exit as a runtime failure", async () => {
    const sessiond = new FakeChild(true);
    const server = new FakeChild();
    const spawnService = vi.fn((service: "sessiond" | "server") =>
      service === "sessiond" ? sessiond : server
    );
    const dependencies = createDependencies(spawnService, async () => undefined);
    const runtime = runCombined(dependencies);
    await vi.waitFor(() => expect(spawnService).toHaveBeenCalledTimes(2));

    server.finish(0);

    await expect(runtime).rejects.toThrow("server exited with code 0");
    expect(sessiond.killSignals).toContain("SIGTERM");
  });

  it("reports a sessiond spawn error as a startup failure", async () => {
    const spawnError = new Error("spawn denied");
    const sessiond = new FakeChild();
    const spawnService = vi.fn(() => sessiond);
    const dependencies = createDependencies(
      spawnService,
      async () => await new Promise<void>(() => undefined)
    );
    const runtime = runCombined(dependencies);
    await vi.waitFor(() => expect(spawnService).toHaveBeenCalledOnce());

    sessiond.failToSpawn(spawnError);

    await expect(runtime).rejects.toThrow(
      "sessiond failed to start before becoming ready: spawn denied"
    );
  });
});

describe("CLI installation", () => {
  it("shows a newly generated key before a later activation failure", async () => {
    const output: string[] = [];
    const activationError = new Error("systemctl enable failed");
    const activate = vi.fn(async () => {
      expect(output.join("")).toContain("new-one-time-key");
      throw activationError;
    });

    await expect(
      activateInstallation(
        "new-one-time-key",
        activate,
        (value) => output.push(value)
      )
    ).rejects.toBe(activationError);

    expect(activate).toHaveBeenCalledOnce();
    expect(output.join("")).toContain("Access key (shown once)");
    expect(output.join("").match(/new-one-time-key/g)).toHaveLength(1);
  });
});

function createDependencies(
  spawnService: CombinedRuntimeDependencies["spawnService"],
  waitForSessiond: CombinedRuntimeDependencies["waitForSessiond"]
): CombinedRuntimeDependencies {
  return {
    spawnService,
    waitForSessiond,
    addSignalListener: vi.fn(
      (_signal: "SIGINT" | "SIGTERM", _listener: () => void) => undefined
    ),
    removeSignalListener: vi.fn(
      (_signal: "SIGINT" | "SIGTERM", _listener: () => void) => undefined
    ),
    terminationGraceMs: 10_000
  };
}
