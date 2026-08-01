import { mkdtemp } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureDirectories,
  resolvePaths
} from "@pi-web/config";
import { SessionDatabase } from "./database.js";
import { runSessiond } from "./main.js";
import { acquireSessiondOwnerLease } from "./owner-lease.js";

describe.sequential("runSessiond startup cleanup", () => {
  const savedEnvironment = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnvironment)) delete process.env[key];
    }
    Object.assign(process.env, savedEnvironment);
  });

  it("stops a listening IPC server before releasing a failed startup lease", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-startup-cleanup-"));
    process.env.PI_WEB_DATA_DIR = join(root, "data");
    process.env.PI_WEB_CONFIG_DIR = join(root, "config");
    process.env.PI_WEB_CACHE_DIR = join(root, "cache");
    process.env.PI_WEB_ALLOWED_ROOTS = root;
    process.env.PI_WEB_ALLOW_ANY_DIRECTORY = "true";
    const paths = resolvePaths();
    await ensureDirectories(paths);
    const db = new SessionDatabase(paths.databaseFile);
    db.createJob(
      {
        name: "invalid persisted schedule",
        enabled: true,
        cronExpression: "not-a-cron",
        timezone: "UTC",
        cwd: root,
        prompt: "never run",
        model: null,
        thinkingLevel: null,
        timeoutSeconds: 60,
        overlapPolicy: "skip"
      },
      {
        createdBy: "import",
        nextRunAt: null
      }
    );
    db.close();

    await expect(runSessiond()).rejects.toBeDefined();
    await expect(canConnect(paths.socketPath)).resolves.toBe(false);
    const nextOwner = await acquireSessiondOwnerLease(paths);
    await nextOwner.release();
  });

  it("makes every close caller wait for the same authority cleanup", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-close-cleanup-"));
    process.env.PI_WEB_DATA_DIR = join(root, "data");
    process.env.PI_WEB_CONFIG_DIR = join(root, "config");
    process.env.PI_WEB_CACHE_DIR = join(root, "cache");
    process.env.PI_WEB_ALLOWED_ROOTS = root;
    process.env.PI_WEB_ALLOW_ANY_DIRECTORY = "true";
    const runtime = await runSessiond();

    const first = runtime.close();
    const second = runtime.close();

    expect(second).toBe(first);
    await Promise.all([first, second]);
  });
});

async function canConnect(socketPath: string): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = createConnection(socketPath);
    let settled = false;
    const finish = (connected: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(connected);
    };
    socket.setTimeout(500, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}
