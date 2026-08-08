import { describe, expect, it } from "vitest";
import { PiRpcWorker, workerEnvironment } from "./worker.js";

const rpcFixture = `
let buffer = "";
if (process.platform !== "win32") {
  process.on("SIGTERM", () => undefined);
}
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let newline = buffer.indexOf("\\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line) {
      const request = JSON.parse(line);
      process.stdout.write(JSON.stringify({
        type: "response",
        command: request.type,
        success: true,
        id: request.id,
        data: { sessionFile: null }
      }) + "\\n");
    }
    newline = buffer.indexOf("\\n");
  }
});
process.stdin.resume();
`;

describe("PiRpcWorker.close", () => {
  it("waits for the child exit after the hard-kill grace period", async () => {
    const worker = await startFixtureWorker();
    let exited = false;
    worker.once("exit", () => {
      exited = true;
    });

    await worker.close(0);

    expect(exited).toBe(true);
    expect(worker.pid).toBeNull();
  });

  it("shares an in-flight close and remains safe after exit", async () => {
    const worker = await startFixtureWorker();
    let exits = 0;
    worker.on("exit", () => {
      exits += 1;
    });

    const first = worker.close(0);
    const concurrent = worker.close(0);

    expect(concurrent).toBe(first);
    await Promise.all([first, concurrent]);
    await expect(worker.close(0)).resolves.toBeUndefined();
    expect(exits).toBe(1);
  });
});

describe("PiRpcWorker environment", () => {
  it("does not inherit the web access key or stale scheduler authority", () => {
    const environment = workerEnvironment(
      {
        SAFE_VALUE: "preserved",
        PI_WEB_ACCESS_KEY: "inherited-secret",
        PI_WEB_FAKE_PI: "inherited-fixture",
        PI_WEB_SCHEDULER_EXTENSION: "inherited-extension",
        PI_WEB_SCHEDULER_SOCKET: "inherited-socket",
        PI_WEB_SCHEDULER_TOKEN: "inherited-token",
        PI_WEB_SESSION_ID: "inherited-session"
      },
      {
        PI_WEB_ACCESS_KEY: "override-secret",
        PI_WEB_SCHEDULER_SOCKET: "worker-socket",
        PI_WEB_SCHEDULER_TOKEN: "worker-token",
        PI_WEB_SESSION_ID: "worker-session"
      }
    );

    expect(environment).toMatchObject({
      SAFE_VALUE: "preserved",
      PI_WEB_SCHEDULER_SOCKET: "worker-socket",
      PI_WEB_SCHEDULER_TOKEN: "worker-token",
      PI_WEB_SESSION_ID: "worker-session"
    });
    expect(environment.PI_WEB_ACCESS_KEY).toBeUndefined();
    expect(environment.PI_WEB_FAKE_PI).toBeUndefined();
    expect(environment.PI_WEB_SCHEDULER_EXTENSION).toBeUndefined();
  });

  it("filters sensitive environment keys case-insensitively", () => {
    const environment = workerEnvironment(
      {
        Path: "preserved",
        pi_web_access_key: "inherited-secret",
        Pi_Web_Scheduler_Token: "inherited-token"
      },
      {
        pi_web_access_key: "override-secret",
        PI_WEB_SCHEDULER_TOKEN: "worker-token"
      }
    );

    expect(environment).toEqual({
      Path: "preserved",
      PI_WEB_SCHEDULER_TOKEN: "worker-token"
    });
  });
});

async function startFixtureWorker(): Promise<PiRpcWorker> {
  const worker = new PiRpcWorker({
    executable: process.execPath,
    prefixArgs: ["-e", rpcFixture, "--"],
    cwd: process.cwd(),
    name: "pi-rpc-close-test"
  });
  await worker.start();
  return worker;
}
