import { mkdtemp } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type {
  RealtimeEvent,
  ScheduledJob,
  ScheduledRun,
  SessionRecord,
  SessionSnapshot
} from "@pi-web/protocol";
import { runSessiond } from "../../apps/sessiond/src/main.js";
import { runServer } from "../../apps/server/src/main.js";
import { SessiondClient } from "../../apps/server/src/sessiond-client.js";
import { resolvePaths } from "@pi-web/config";

describe.sequential("session daemon integration", () => {
  const saved = { ...process.env };
  let closeRuntime: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (closeRuntime) await closeRuntime();
    closeRuntime = null;
    for (const key of Object.keys(process.env)) {
      if (!(key in saved)) delete process.env[key];
    }
    Object.assign(process.env, saved);
  });

  async function startRuntime() {
    const root = await mkdtemp(join(tmpdir(), "pi-web-integration-"));
    process.env.PI_WEB_DATA_DIR = join(root, "data");
    process.env.PI_WEB_CONFIG_DIR = join(root, "config");
    process.env.PI_WEB_CACHE_DIR = join(root, "cache");
    process.env.PI_WEB_ALLOWED_ROOTS = root;
    process.env.PI_WEB_ALLOW_ANY_DIRECTORY = "true";
    process.env.PI_WEB_DEFAULT_SYSTEM_PROMPT = "Always explain failures clearly.";
    process.env.PI_WEB_FAKE_PI = fileURLToPath(
      new URL("../fixtures/fake-pi.mjs", import.meta.url)
    );
    const runtime = await runSessiond();
    closeRuntime = runtime.close;
    const paths = resolvePaths();
    const client = new SessiondClient(paths.socketPath, paths.ipcTokenFile);
    await client.start();
    return { root, client };
  }

  it("keeps a fake RPC worker running across server-client disconnect", async () => {
    const { root, client: firstClient } = await startRuntime();
    const paths = resolvePaths();
    const session = await firstClient.request<SessionRecord>("sessions.create", {
      cwd: root,
      displayName: "persistent",
      prompt: "slow tool task"
    });
    firstClient.stop();

    await new Promise((resolve) => setTimeout(resolve, 650));
    const secondClient = new SessiondClient(
      paths.socketPath,
      paths.ipcTokenFile
    );
    await secondClient.start();
    const snapshot = await secondClient.request<SessionSnapshot>("sessions.snapshot", {
      id: session.id
    });
    expect(snapshot.session.status).toBe("waiting");
    expect(snapshot.session.systemPrompt).toBe("Always explain failures clearly.");
    expect(String(snapshot.state?.systemPrompt)).toContain(
      "Always explain failures clearly."
    );
    expect(
      snapshot.messages.some(
        (message) =>
          message.role === "assistant" &&
          JSON.stringify(message.content).includes("Completed")
      )
    ).toBe(true);
    expect(
      (
        (snapshot.state?.sessionStats as Record<string, unknown>)
          .contextUsage as Record<string, unknown>
      ).contextWindow
    ).toBe(200_000);
    await secondClient.request("sessions.close", { id: session.id });
    secondClient.stop();
  });

  it("keeps an active worker alive across a real web server restart", async () => {
    process.env.PI_WEB_PORT = String(await freePort());
    process.env.PI_WEB_HOST = "127.0.0.1";
    process.env.PI_WEB_ACCESS_KEY = "integration-access-key";
    const { root, client } = await startRuntime();
    let server = await runServer();
    try {
      const session = await client.request<SessionRecord>("sessions.create", {
        cwd: root,
        displayName: "server restart",
        prompt: "hang across server restart"
      });
      await waitFor(async () => (await client.request<SessionRecord>("sessions.get", {
        id: session.id
      })).status === "running");
      await server.close();
      expect(
        (await client.request<SessionRecord>("sessions.get", { id: session.id }))
          .status
      ).toBe("running");
      server = await runServer();
      expect(
        (await client.request<SessionRecord>("sessions.get", { id: session.id }))
          .status
      ).toBe("running");
      await client.request("sessions.close", { id: session.id });
    } finally {
      await server.close().catch(() => undefined);
      client.stop();
    }
  });

  it("projects queued messages and session tree data into snapshots", async () => {
    const { root, client } = await startRuntime();
    const events: RealtimeEvent[] = [];
    client.on("event", (event: RealtimeEvent) => events.push(event));
    const session = await client.request<SessionRecord>("sessions.create", {
      cwd: root,
      displayName: "queue projection",
      prompt: "hang with queue"
    });
    await waitFor(
      async () =>
        (
          await client.request<SessionRecord>("sessions.get", {
            id: session.id
          })
        ).status === "running"
    );

    await client.request("sessions.prompt", {
      id: session.id,
      message: "summarize after completion",
      behavior: "follow_up",
      images: []
    });
    await waitFor(() =>
      Promise.resolve(
        events.some((event) => event.type === "pi.queue_update")
      )
    );

    const snapshot = await client.request<SessionSnapshot>(
      "sessions.snapshot",
      { id: session.id }
    );
    expect(snapshot.queuedMessages).toEqual({
      steering: [],
      followUp: ["summarize after completion"]
    });
    expect(snapshot.tree?.nodes.length).toBeGreaterThan(0);
    expect(snapshot.tree?.activePathIds.length).toBeGreaterThan(0);
    await client.request("sessions.close", { id: session.id });
    client.stop();
  });

  it("handles aborts, malformed events, extension errors, and worker crashes honestly", async () => {
    const { root, client } = await startRuntime();
    const events: RealtimeEvent[] = [];
    client.on("event", (event: RealtimeEvent) => events.push(event));

    const aborted = await client.request<SessionRecord>("sessions.create", {
      cwd: root,
      displayName: "abort",
      prompt: "slow tool task"
    });
    await waitFor(async () => (await client.request<SessionRecord>("sessions.get", {
      id: aborted.id
    })).status === "running");
    await client.request("sessions.abort", { id: aborted.id });
    await waitFor(async () => (await client.request<SessionRecord>("sessions.get", {
      id: aborted.id
    })).status === "waiting");

    const malformed = await client.request<SessionRecord>("sessions.create", {
      cwd: root,
      displayName: "malformed",
      prompt: "invalid extension-error task"
    });
    await waitFor(async () => (await client.request<SessionRecord>("sessions.get", {
      id: malformed.id
    })).status === "waiting");
    await waitFor(() =>
      Promise.resolve(
        events.some(
          (event) =>
            event.sessionId === malformed.id &&
            event.type === "pi.protocol_error"
        ) &&
          events.some(
            (event) =>
              event.sessionId === malformed.id &&
              event.type === "pi.extension_error"
          )
      )
    );
    expect(
      events.some(
        (event) =>
          event.sessionId === malformed.id && event.type === "pi.protocol_error"
      )
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.sessionId === malformed.id && event.type === "pi.extension_error"
      )
    ).toBe(true);

    const crashed = await client.request<SessionRecord>("sessions.create", {
      cwd: root,
      displayName: "crash",
      prompt: "crash now"
    });
    await waitFor(async () => {
      const status = (await client.request<SessionRecord>("sessions.get", {
        id: crashed.id
      })).status;
      return status === "interrupted" || status === "failed";
    });
    const crashRow = await client.request<SessionRecord>("sessions.get", {
      id: crashed.id
    });
    expect(crashRow.status).toBe("interrupted");
    expect(crashRow.exitCode).toBe(23);

    const sequences = events.map((event) => `${event.sessionId}:${event.sequence}`);
    expect(new Set(sequences).size).toBe(sequences.length);
    client.stop();
  });

  it("creates linked cron sessions, skips overlap, and preserves timeout status", async () => {
    const { root, client } = await startRuntime();
    const base = {
      enabled: true,
      cronExpression: "0 9 * * *",
      timezone: "UTC",
      cwd: root,
      model: null,
      thinkingLevel: null,
      overlapPolicy: "skip" as const
    };
    const overlapJob = await client.request<ScheduledJob>("schedules.create", {
      ...base,
      name: "overlap",
      prompt: "slow scheduled task",
      timeoutSeconds: 60
    });
    const first = await client.request<ScheduledRun>("schedules.run_now", {
      id: overlapJob.id
    });
    const skipped = await client.request<ScheduledRun>("schedules.run_now", {
      id: overlapJob.id
    });
    expect(first.status).toBe("running");
    expect(skipped.status).toBe("skipped_overlap");
    await waitFor(async () => {
      const runs = await client.request<ScheduledRun[]>("schedules.runs", {
        jobId: overlapJob.id
      });
      return runs.some((run) => run.id === first.id && run.status === "succeeded");
    });
    const finished = (
      await client.request<ScheduledRun[]>("schedules.runs", {
        jobId: overlapJob.id
      })
    ).find((run) => run.id === first.id);
    expect(finished?.sessionId).toBeTruthy();

    const timeoutJob = await client.request<ScheduledJob>("schedules.create", {
      ...base,
      name: "timeout",
      prompt: "hang forever",
      timeoutSeconds: 1
    });
    const timed = await client.request<ScheduledRun>("schedules.run_now", {
      id: timeoutJob.id
    });
    await waitFor(
      async () =>
        (
          await client.request<ScheduledRun[]>("schedules.runs", {
            jobId: timeoutJob.id
          })
        ).some((run) => run.id === timed.id && run.status === "timed_out"),
      4000
    );
    const timedRow = (
      await client.request<ScheduledRun[]>("schedules.runs", {
        jobId: timeoutJob.id
      })
    ).find((run) => run.id === timed.id);
    expect(timedRow?.status).toBe("timed_out");
    expect(timedRow?.sessionId).toBeTruthy();
    client.stop();
  });
});

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 2500
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Condition did not become true within ${timeoutMs}ms`);
}

async function freePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a TCP port"));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}
