import { access, chmod, mkdtemp, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type {
  RealtimeEvent,
  SessionRecord,
  SessionSnapshot
} from "@pi-web/protocol";
import { SessionDatabase } from "../../apps/sessiond/src/database.js";
import { runSessiond } from "../../apps/sessiond/src/main.js";
import { fingerprintMutationPayload } from "../../apps/sessiond/src/mutation-fingerprint.js";
import { acquireSessiondOwnerLease } from "../../apps/sessiond/src/owner-lease.js";
import { runServer } from "../../apps/server/src/main.js";
import { SessiondClient } from "@pi-web/ipc";
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

  async function startRuntime(options: { productionPiShim?: boolean } = {}) {
    const root = await mkdtemp(join(tmpdir(), "pi-web-integration-"));
    process.env.PI_WEB_DATA_DIR = join(root, "data");
    process.env.PI_WEB_CONFIG_DIR = join(root, "config");
    process.env.PI_WEB_CACHE_DIR = join(root, "cache");
    process.env.PI_WEB_ALLOWED_ROOTS = root;
    process.env.PI_WEB_ALLOW_ANY_DIRECTORY = "true";
    process.env.PI_WEB_DEFAULT_SYSTEM_PROMPT = "Always explain failures clearly.";
    process.env.PI_WEB_FAKE_SESSION_DIR = join(root, "pi-sessions");
    let compatibilityMarker: string | null = null;
    if (options.productionPiShim) {
      delete process.env.PI_WEB_FAKE_PI;
      compatibilityMarker = join(root, "compatibility-started");
      const shim = join(root, "pi-production-shim.mjs");
      const fakePi = fileURLToPath(
        new URL("../fixtures/fake-pi.mjs", import.meta.url)
      );
      await writeFile(
        shim,
        `#!/usr/bin/env node\n` +
          `import { writeFileSync } from "node:fs";\n` +
          `if (process.argv.includes("--version")) {\n` +
          `  writeFileSync(${JSON.stringify(compatibilityMarker)}, "started");\n` +
          `  await new Promise((resolve) => setTimeout(resolve, 500));\n` +
          `  process.stdout.write("Pi Coding Agent 0.84.1\\n");\n` +
          `} else {\n` +
          `  await import(${JSON.stringify(new URL(`file://${fakePi}`).href)});\n` +
          `}\n`,
        { mode: 0o700 }
      );
      await chmod(shim, 0o700);
      process.env.PI_WEB_PI_EXECUTABLE = shim;
    } else {
      process.env.PI_WEB_FAKE_PI = fileURLToPath(
        new URL("../fixtures/fake-pi.mjs", import.meta.url)
      );
    }
    const runtime = await runSessiond();
    closeRuntime = runtime.close;
    const paths = resolvePaths();
    const client = new SessiondClient(paths.socketPath, paths.ipcTokenFile);
    await client.start();
    return { root, client, compatibilityMarker };
  }

  it("keeps a fake RPC worker running across server-client disconnect", async () => {
    const { root, client: firstClient } = await startRuntime();
    const paths = resolvePaths();
    const session = await firstClient.request("sessions.create", {
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
    await waitFor(
      async () =>
        (
          await secondClient.request("sessions.get", {
            id: session.id
          })
        ).status === "waiting"
    );
    const snapshot = await secondClient.request("sessions.snapshot", {
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
        snapshot.sessionStats?.contextUsage as Record<string, unknown>
      ).contextWindow
    ).toBe(200_000);
    await secondClient.request("sessions.close", { id: session.id });
    secondClient.stop();
  });

  it("returns a snapshot when persisted sequence history outlives the replay ring", async () => {
    const { root, client: firstClient } = await startRuntime();
    const paths = resolvePaths();
    const session = await firstClient.request("sessions.create", {
      cwd: root,
      displayName: "restart replay boundary",
      prompt: "persist before restart"
    });
    await waitFor(
      async () =>
        (
          await firstClient.request("sessions.get", {
            id: session.id
          })
        ).status === "waiting"
    );
    const initial = await firstClient.request(
      "sessions.snapshot",
      { id: session.id }
    );
    firstClient.stop();
    await closeRuntime!();
    closeRuntime = null;

    const restarted = await runSessiond();
    closeRuntime = restarted.close;
    const secondClient = new SessiondClient(
      paths.socketPath,
      paths.ipcTokenFile
    );
    await secondClient.start();
    const sync = await secondClient.request("sessions.sync", {
      id: session.id,
      projectionEpoch: initial.projectionEpoch,
      afterSequence: initial.sequence
    });

    expect(sync.mode).toBe("snapshot");
    expect(sync.snapshot?.projectionEpoch).not.toBe(initial.projectionEpoch);
    secondClient.stop();
  });

  it("persists extension UI interactions across snapshots and resumes the worker after one response", async () => {
    const { root, client } = await startRuntime();
    const events: RealtimeEvent[] = [];
    client.on("event", (event: RealtimeEvent) => events.push(event));
    const session = await client.request("sessions.create", {
      cwd: root,
      displayName: "extension UI",
      prompt: "extension-confirm"
    });

    let snapshot!: SessionSnapshot;
    await waitFor(async () => {
      snapshot = await client.request("sessions.snapshot", {
        id: session.id
      });
      return snapshot.pendingInteractions.length === 1;
    });
    const interaction = snapshot.pendingInteractions[0]!;
    expect(interaction).toMatchObject({
      method: "confirm",
      title: "Allow fake operation?"
    });

    const refreshed = await client.request(
      "sessions.snapshot",
      { id: session.id }
    );
    expect(refreshed.pendingInteractions).toEqual([interaction]);

    const mutationId = "12345678-1234-4234-8234-123456789abc";
    await expect(
      client.request("sessions.extension_ui_response", {
        id: session.id,
        mutationId,
        interactionId: interaction.id,
        confirmed: true
      })
    ).resolves.toEqual({ accepted: true });
    await waitFor(
      async () =>
        (
          await client.request("sessions.get", {
            id: session.id
          })
        ).status === "waiting"
    );
    const completed = await client.request(
      "sessions.snapshot",
      { id: session.id }
    );
    expect(completed.pendingInteractions).toEqual([]);
    expect(JSON.stringify(completed.messages)).toContain(
      "Fake extension request was confirmed."
    );
    expect(
      events.some((event) => event.type === "extension_ui.resolved")
    ).toBe(true);

    await expect(
      client.request("sessions.extension_ui_response", {
        id: session.id,
        mutationId: "22345678-1234-4234-8234-123456789abc",
        interactionId: interaction.id,
        confirmed: true
      })
    ).rejects.toMatchObject({ code: "EXTENSION_UI_NOT_PENDING" });
    await client.request("sessions.close", { id: session.id });
    client.stop();
  });

  it("drains new worker starts around an explicitly forced service change", async () => {
    const { root, client } = await startRuntime();
    const running = await client.request("sessions.create", {
      cwd: root,
      displayName: "service drain owner",
      prompt: "hang during service drain"
    });
    await waitFor(
      async () =>
        (
          await client.request("sessions.get", {
            id: running.id
          })
        ).status === "running"
    );

    await expect(
      client.request("service.prepare_change", {
        action: "restart",
        force: false
      })
    ).rejects.toMatchObject({ code: "ACTIVE_WORKERS_BLOCK_SERVICE_CHANGE" });
    await expect(
      client.request("service.prepare_change", {
        action: "restart",
        force: true
      })
    ).resolves.toEqual({ activeWorkers: 1, forced: true });
    await expect(
      client.request("sessions.create", {
        cwd: root,
        displayName: "blocked by drain",
        images: []
      })
    ).rejects.toMatchObject({ code: "SESSIOND_DRAINING" });

    await client.request("service.cancel_change");
    const admitted = await client.request("sessions.create", {
      cwd: root,
      displayName: "admitted after drain",
      images: []
    });
    await client.request("sessions.close", { id: admitted.id });
    await client.request("sessions.close", { id: running.id });
    client.stop();
  });

  it("blocks package changes before invoking Pi while a worker is active", async () => {
    const { root, client } = await startRuntime();
    const running = await client.request("sessions.create", {
      cwd: root,
      displayName: "package gate owner",
      prompt: "hang during package gate"
    });
    await waitFor(
      async () =>
        (
          await client.request("sessions.get", {
            id: running.id
          })
        ).status === "running"
    );

    await expect(
      client.request("pi.package", {
        action: "update_all",
        force: false
      })
    ).rejects.toMatchObject({ code: "ACTIVE_WORKERS_BLOCK_PI_CHANGE" });

    await client.request("sessions.close", { id: running.id });
    client.stop();
  });

  it("keeps an active worker alive across a real web server restart", async () => {
    process.env.PI_WEB_PORT = String(await freePort());
    process.env.PI_WEB_HOST = "127.0.0.1";
    process.env.PI_WEB_ACCESS_KEY = "integration-access-key";
    const { root, client } = await startRuntime();
    let server = await runServer();
    try {
      const session = await client.request("sessions.create", {
        cwd: root,
        displayName: "server restart",
        prompt: "hang across server restart"
      });
      await waitFor(async () => (await client.request("sessions.get", {
        id: session.id
      })).status === "running");
      await server.close();
      expect(
        (await client.request("sessions.get", { id: session.id }))
          .status
      ).toBe("running");
      server = await runServer();
      expect(
        (await client.request("sessions.get", { id: session.id }))
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
    const session = await client.request("sessions.create", {
      cwd: root,
      displayName: "queue projection",
      prompt: "hang with queue"
    });
    await waitFor(
      async () =>
        (
          await client.request("sessions.get", {
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

    const snapshot = await client.request(
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

  it("does not advance a snapshot past a final message before Pi persists it", async () => {
    const { root, client } = await startRuntime();
    let resolveMessageEnd!: () => void;
    const messageEnded = new Promise<void>((resolve) => {
      resolveMessageEnd = resolve;
    });
    client.on("event", (event: RealtimeEvent) => {
      if (event.type === "pi.message_end") resolveMessageEnd();
    });
    const session = await client.request("sessions.create", {
      cwd: root,
      displayName: "snapshot persistence barrier",
      prompt: "event-before-persist"
    });

    await messageEnded;
    const snapshot = await client.request(
      "sessions.snapshot",
      { id: session.id }
    );

    expect(
      snapshot.messages.some(
        (message) =>
          message.role === "assistant" &&
          JSON.stringify(message.content).includes(
            "Completed: event-before-persist"
          )
      )
    ).toBe(true);
    await client.request("sessions.close", { id: session.id });
    client.stop();
  });

  it("deduplicates create and prompt mutations without swallowing retries", async () => {
    const { root, client } = await startRuntime();
    const events: RealtimeEvent[] = [];
    client.on("event", (event: RealtimeEvent) => events.push(event));
    const createMutationId = "4b650b13-d818-4931-b193-c2da51c2b27b";
    const createPayload = {
      mutationId: createMutationId,
      cwd: root,
      displayName: "idempotent",
      images: []
    };

    const [first, concurrent] = await Promise.all([
      client.request("sessions.create", createPayload),
      client.request("sessions.create", createPayload)
    ]);
    expect(concurrent.id).toBe(first.id);
    expect(
      (await client.request("sessions.list", {})).sessions.filter(
        (session) => session.displayName === "idempotent"
      )
    ).toHaveLength(1);
    await expect(
      client.request("sessions.create", {
        ...createPayload,
        displayName: "changed payload"
      })
    ).rejects.toMatchObject({
      code: "MUTATION_ID_REUSED",
      statusCode: 409
    });
    await waitFor(
      async () =>
        (
          await client.request("sessions.get", {
            id: first.id
          })
        ).status === "waiting"
    );

    const promptMutationId = "eeacdf65-ec8c-46ce-8b10-709d292e4b7d";
    const promptPayload = {
      id: first.id,
      mutationId: promptMutationId,
      message: "slow tool task",
      behavior: "prompt",
      images: []
    };
    await Promise.all([
      client.request("sessions.prompt", promptPayload),
      client.request("sessions.prompt", promptPayload)
    ]);
    expect(
      events.filter(
        (event) =>
          event.sessionId === first.id &&
          event.type === "input.accepted"
      )
    ).toHaveLength(1);
    await expect(
      client.request("sessions.prompt", {
        ...promptPayload,
        message: "changed payload"
      })
    ).rejects.toMatchObject({
      code: "MUTATION_ID_REUSED",
      statusCode: 409
    });

    const retryMutationId = "8b7990a2-2436-44f9-a768-56689fd5e55e";
    const retryPayload = {
      id: first.id,
      mutationId: retryMutationId,
      message: "retry after busy",
      behavior: "prompt",
      images: []
    };
    await expect(
      client.request("sessions.prompt", retryPayload)
    ).rejects.toMatchObject({ code: "SESSION_BUSY" });
    await waitFor(
      async () =>
        (
          await client.request("sessions.get", {
            id: first.id
          })
        ).status === "waiting"
    );
    await client.request("sessions.prompt", retryPayload);

    await Promise.all([
      client.request("sessions.prompt", {
        id: first.id,
        mutationId: "156e6d65-e42f-4268-9b7b-32bf0fc4c257",
        message: "first distinct follow-up",
        behavior: "follow_up",
        images: []
      }),
      client.request("sessions.prompt", {
        id: first.id,
        mutationId: "aa4cf4ad-47a0-4868-9644-b9a798772347",
        message: "second distinct follow-up",
        behavior: "follow_up",
        images: []
      })
    ]);
    expect(
      events.filter(
        (event) =>
          event.sessionId === first.id &&
          event.type === "input.accepted"
      )
    ).toHaveLength(4);
    await client.request("sessions.close", { id: first.id });
    client.stop();
  });

  it("permanently deletes the Pi session file and database row", async () => {
    const { root, client } = await startRuntime();
    const paths = resolvePaths();
    const session = await client.request("sessions.create", {
      cwd: root,
      displayName: "permanent deletion",
      prompt: "persist before deletion"
    });
    await waitFor(
      async () =>
        (
          await client.request("sessions.get", {
            id: session.id
          })
        ).status === "waiting"
    );
    const persisted = await client.request("sessions.get", {
      id: session.id
    });
    expect(persisted.piSessionReference).toBeTruthy();

    await client.request("sessions.delete", { id: session.id });

    await expect(
      client.request("sessions.get", { id: session.id })
    ).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
    await expect(access(persisted.piSessionReference!)).rejects.toMatchObject({
      code: "ENOENT"
    });
    const inspected = new SessionDatabase(paths.databaseFile);
    expect(
      inspected.db.prepare("SELECT id FROM sessions WHERE id = ?").get(session.id)
    ).toBeUndefined();
    inspected.close();
    client.stop();
  });

  it("recovers an incomplete durable create mutation in the original session", async () => {
    const { root, client } = await startRuntime();
    const paths = resolvePaths();
    const mutationId = "6405643f-8575-4e5b-88fe-34ffbcba11c7";
    const mutationPayload = {
      cwd: root,
      displayName: "recover pending create",
      prompt: "recovered initial prompt",
      createdBy: "web" as const
    };
    const direct = new SessionDatabase(paths.databaseFile);
    const pending = direct.sessions.createOrReuse({
      cwd: root,
      displayName: mutationPayload.displayName,
      createdBy: "web",
      mutationId,
      mutationFingerprint: fingerprintMutationPayload(mutationPayload)
    });
    direct.close();

    const recovered = await client.request("sessions.create", {
      mutationId,
      cwd: root,
      displayName: mutationPayload.displayName,
      prompt: mutationPayload.prompt,
      images: []
    });

    expect(recovered.id).toBe(pending.session.id);
    expect(recovered.status).toBe("running");
    const inspected = new SessionDatabase(paths.databaseFile);
    expect(inspected.sessions.findCreateMutation(mutationId)?.completed).toBe(true);
    inspected.close();
    await client.request("sessions.close", { id: recovered.id });
    client.stop();
  });

  it("serializes concurrent resumes without dropping either prompt", async () => {
    const { root, client } = await startRuntime();
    const events: RealtimeEvent[] = [];
    client.on("event", (event: RealtimeEvent) => events.push(event));
    const session = await client.request("sessions.create", {
      cwd: root,
      displayName: "single resume owner",
      prompt: "persist for resume"
    });
    await waitFor(
      async () =>
        (
          await client.request("sessions.get", {
            id: session.id
          })
        ).status === "waiting"
    );
    await client.request("sessions.close", { id: session.id });
    await waitFor(
      async () =>
        (
          await client.request("sessions.get", {
            id: session.id
          })
        ).status === "closed"
    );
    const readyBefore = events.filter(
      (event) =>
        event.sessionId === session.id && event.type === "session.ready"
    ).length;

    const resumed = await Promise.all([
      client.request("sessions.resume", {
        id: session.id,
        mutationId: "5eb3c76b-ed61-4806-8c16-e811f6a99cba",
        prompt: "first concurrent resume",
        images: []
      }),
      client.request("sessions.resume", {
        id: session.id,
        mutationId: "92f17c59-710f-43f9-86a2-757ab7c95826",
        prompt: "second concurrent resume",
        images: []
      })
    ]);
    await waitFor(
      () =>
        Promise.resolve(
          events.filter(
            (event) =>
              event.sessionId === session.id &&
              event.type === "session.ready"
          ).length > readyBefore
        )
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(resumed.map((item) => item.id)).toEqual([
      session.id,
      session.id
    ]);
    expect(
      events.filter(
        (event) =>
          event.sessionId === session.id && event.type === "session.ready"
      )
    ).toHaveLength(readyBefore + 1);
    await waitFor(
      async () =>
        (
          await client.request("sessions.get", {
            id: session.id
          })
        ).status === "waiting"
    );
    const snapshot = await client.request(
      "sessions.snapshot",
      { id: session.id }
    );
    const userMessages = snapshot.messages
      .filter((message) => message.role === "user")
      .map((message) => message.content);
    expect(userMessages).toEqual([
      "persist for resume",
      "first concurrent resume",
      "second concurrent resume"
    ]);
    await client.request("sessions.resume", {
      id: session.id,
      mutationId: "f8aa1200-802f-46a0-bca6-10ec72a1e8cc",
      prompt: "resume while already active",
      images: []
    });
    await waitFor(
      async () =>
        (
          await client.request("sessions.get", {
            id: session.id
          })
        ).status === "waiting"
    );
    const activeSnapshot = await client.request(
      "sessions.snapshot",
      { id: session.id }
    );
    expect(
      activeSnapshot.messages
        .filter((message) => message.role === "user")
        .map((message) => message.content)
    ).toEqual([...userMessages, "resume while already active"]);
    await client.request("sessions.close", { id: session.id });
    client.stop();
  });

  it("drains an accepted worker startup before releasing sessiond ownership", async () => {
    const { root, client } = await startRuntime();
    const session = await client.request("sessions.create", {
      cwd: root,
      displayName: "shutdown startup fence",
      prompt: "persist before delayed resume"
    });
    await waitFor(
      async () =>
        (
          await client.request("sessions.get", {
            id: session.id
          })
        ).status === "waiting"
    );
    await client.request("sessions.close", { id: session.id });
    process.env.PI_WEB_FAKE_START_DELAY_MS = "300";
    const resumed = client
      .request("sessions.resume", {
        id: session.id,
        mutationId: "bd1c3b67-4c0b-468c-8f8e-68a21f194eb6",
        images: []
      })
      .catch((error) => error);
    await waitFor(
      async () =>
        (
          await client.request("sessions.get", {
            id: session.id
          })
        ).status === "starting"
    );

    let closeSettled = false;
    const closing = closeRuntime!().then(() => {
      closeSettled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(closeSettled).toBe(false);
    await closing;
    closeRuntime = null;
    await resumed;
    client.stop();

    const nextOwner = await acquireSessiondOwnerLease(resolvePaths());
    await nextOwner.release();
  });

  it("holds worker capacity while the production compatibility probe is pending", async () => {
    process.env.PI_WEB_MAX_CONCURRENT_WORKERS = "1";
    const { root, client, compatibilityMarker } = await startRuntime({
      productionPiShim: true
    });
    const first = client.request("sessions.create", {
      cwd: root,
      displayName: "production admission owner"
    });
    await waitFor(async () => {
      try {
        await access(compatibilityMarker!);
        return true;
      } catch {
        return false;
      }
    });

    await expect(
      client.request("sessions.create", {
        cwd: root,
        displayName: "must not exceed capacity"
      })
    ).rejects.toMatchObject({ code: "WORKER_LIMIT", statusCode: 429 });

    const admitted = await first;
    await waitFor(
      async () =>
        (
          await client.request("sessions.get", {
            id: admitted.id
          })
        ).status === "waiting",
      4_000
    );
    await client.request("sessions.close", { id: admitted.id });
    client.stop();
  });

  it("reserves global worker capacity across concurrent directory checks", async () => {
    process.env.PI_WEB_MAX_CONCURRENT_WORKERS = "1";
    const { root, client } = await startRuntime();
    const createPersistedSession = async (displayName: string) => {
      const session = await client.request("sessions.create", {
        cwd: root,
        displayName,
        prompt: `persist ${displayName}`
      });
      await waitFor(
        async () =>
          (
            await client.request("sessions.get", {
              id: session.id
            })
          ).status === "waiting"
      );
      await client.request("sessions.close", { id: session.id });
      await waitFor(
        async () =>
          (
            await client.request("sessions.get", {
              id: session.id
            })
          ).status === "closed"
      );
      return session;
    };
    const first = await createPersistedSession("capacity first");
    const second = await createPersistedSession("capacity second");

    const attempts = await Promise.allSettled([
      client.request("sessions.resume", {
        id: first.id,
        mutationId: "d2a2baf0-2d11-44c7-a1bd-1bb2a4b8f8ef",
        images: []
      }),
      client.request("sessions.resume", {
        id: second.id,
        mutationId: "0207459d-84de-45e8-8302-e9822f985e41",
        images: []
      })
    ]);

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toEqual([
      expect.objectContaining({
        reason: expect.objectContaining({ code: "WORKER_LIMIT" })
      })
    ]);
    const active = attempts.find(
      (attempt): attempt is PromiseFulfilledResult<SessionRecord> =>
        attempt.status === "fulfilled"
    )!.value;
    await client.request("sessions.close", { id: active.id });
    client.stop();
  });

  it("handles aborts, malformed events, extension errors, and worker crashes honestly", async () => {
    const { root, client } = await startRuntime();
    const events: RealtimeEvent[] = [];
    client.on("event", (event: RealtimeEvent) => events.push(event));

    const aborted = await client.request("sessions.create", {
      cwd: root,
      displayName: "abort",
      prompt: "slow tool task"
    });
    await waitFor(async () => (await client.request("sessions.get", {
      id: aborted.id
    })).status === "running");
    await client.request("sessions.abort", { id: aborted.id });
    await waitFor(async () => (await client.request("sessions.get", {
      id: aborted.id
    })).status === "waiting");

    const malformed = await client.request("sessions.create", {
      cwd: root,
      displayName: "malformed",
      prompt: "invalid extension-error task"
    });
    await waitFor(async () => (await client.request("sessions.get", {
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

    const crashed = await client.request("sessions.create", {
      cwd: root,
      displayName: "crash",
      prompt: "crash now"
    });
    await waitFor(async () => {
      const status = (await client.request("sessions.get", {
        id: crashed.id
      })).status;
      return status === "interrupted" || status === "failed";
    });
    const crashRow = await client.request("sessions.get", {
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
    const overlapJob = await client.request("schedules.create", {
      ...base,
      name: "overlap",
      prompt: "slow scheduled task",
      timeoutSeconds: 60
    });
    const first = await client.request("schedules.run_now", {
      id: overlapJob.id
    });
    const skipped = await client.request("schedules.run_now", {
      id: overlapJob.id
    });
    expect(first.status).toBe("running");
    expect(skipped.status).toBe("skipped_overlap");
    await waitFor(async () => {
      const runs = await client.request("schedules.runs", {
        jobId: overlapJob.id
      });
      return runs.some((run) => run.id === first.id && run.status === "succeeded");
    });
    const finished = (
      await client.request("schedules.runs", {
        jobId: overlapJob.id
      })
    ).find((run) => run.id === first.id);
    expect(finished?.sessionId).toBeTruthy();

    const timeoutJob = await client.request("schedules.create", {
      ...base,
      name: "timeout",
      prompt: "hang forever",
      timeoutSeconds: 1
    });
    const timed = await client.request("schedules.run_now", {
      id: timeoutJob.id
    });
    await waitFor(
      async () =>
        (
          await client.request("schedules.runs", {
            jobId: timeoutJob.id
          })
        ).some((run) => run.id === timed.id && run.status === "timed_out"),
      4000
    );
    const timedRow = (
      await client.request("schedules.runs", {
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
