import { randomUUID } from "node:crypto";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { internalProtocolVersion } from "@pi-web/protocol";
import {
  callScheduler,
  type SchedulerContext
} from "./index.js";

const serverSockets = new WeakMap<Server, Set<Socket>>();

describe("scheduler extension transport", () => {
  it("rejects an already-aborted request before connecting", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      callScheduler(context("unused"), { action: "list", source: "model" }, controller.signal)
    ).rejects.toThrow("Scheduler request aborted");
  });

  it("decodes a fragmented UTF-8 response and settles once", async () => {
    const transport = await listen((socket) => {
      respondToRequest(socket, (id) => {
        const response = Buffer.from(
          `${JSON.stringify({
            kind: "response",
            id,
            ok: true,
            result: { message: "你好" }
          })}\n`
        );
        const multibyte = Buffer.from("你");
        const start = response.indexOf(multibyte);
        socket.write(response.subarray(0, start + 1));
        socket.end(response.subarray(start + 1));
      });
    });

    try {
      await expect(
        callScheduler(context(transport.path), {
          action: "list",
          source: "model"
        })
      ).resolves.toEqual({ message: "你好" });
    } finally {
      await closeServer(transport.server);
    }
  });

  it("rejects when the daemon closes before responding", async () => {
    const transport = await listen((socket) => socket.destroy());

    try {
      await expect(
        callScheduler(context(transport.path), {
          action: "list",
          source: "model"
        })
      ).rejects.toThrow(/before a response/);
    } finally {
      await closeServer(transport.server);
    }
  });

  it("rejects an oversized response frame", async () => {
    const transport = await listen((socket) => {
      respondToRequest(socket, (id) => {
        socket.end(
          `${JSON.stringify({
            kind: "response",
            id,
            ok: true,
            result: "x".repeat(128)
          })}\n`
        );
      });
    });

    try {
      await expect(
        callScheduler(
          context(transport.path),
          { action: "list", source: "model" },
          undefined,
          { maxResponseBytes: 64 }
        )
      ).rejects.toThrow("Scheduler response exceeds 64 bytes");
    } finally {
      await closeServer(transport.server);
    }
  });

  it("times out and closes a request that never receives a response", async () => {
    let serverObservedClose = false;
    const transport = await listen((socket) => {
      socket.resume();
      socket.once("close", () => {
        serverObservedClose = true;
      });
    });

    try {
      await expect(
        callScheduler(
          context(transport.path),
          { action: "list", source: "model" },
          undefined,
          { timeoutMs: 20 }
        )
      ).rejects.toThrow("Scheduler request timed out");
      await expect
        .poll(() => serverObservedClose)
        .toBe(true);
    } finally {
      await closeServer(transport.server);
    }
  });

  it("aborts an in-flight request and cleans up its socket", async () => {
    const controller = new AbortController();
    let serverObservedClose = false;
    const transport = await listen((socket) => {
      socket.resume();
      socket.once("close", () => {
        serverObservedClose = true;
      });
      controller.abort();
    });

    try {
      await expect(
        callScheduler(
          context(transport.path),
          { action: "list", source: "model" },
          controller.signal
        )
      ).rejects.toThrow("Scheduler request aborted");
      await expect
        .poll(() => serverObservedClose)
        .toBe(true);
    } finally {
      await closeServer(transport.server);
    }
  });
});

function context(socket: string): SchedulerContext {
  return {
    socket,
    token: "worker-token",
    sessionId: "session-id"
  };
}

async function listen(
  onConnection: (socket: Socket) => void
): Promise<{ server: Server; path: string }> {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    onConnection(socket);
  });
  serverSockets.set(server, sockets);
  const path =
    process.platform === "win32"
      ? `\\\\.\\pipe\\pi-web-scheduler-test-${randomUUID()}`
      : join(tmpdir(), `pi-web-scheduler-test-${randomUUID()}.sock`);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, resolve);
  });
  return { server, path };
}

function respondToRequest(
  socket: Socket,
  respond: (id: string) => void
): void {
  let request = "";
  let handshaken = false;
  socket.on("data", (chunk) => {
    request += chunk.toString("utf8");
    let newline = request.indexOf("\n");
    while (newline >= 0) {
      const line = request.slice(0, newline);
      request = request.slice(newline + 1);
      newline = request.indexOf("\n");
      if (!line) continue;
      const parsed = JSON.parse(line) as {
        id: string;
        method: string;
        protocolVersion: number;
      };
      expect(parsed.protocolVersion).toBe(internalProtocolVersion);
      if (!handshaken) {
        expect(parsed.method).toBe("protocol.handshake");
        handshaken = true;
        socket.write(
          `${JSON.stringify({
            kind: "response",
            id: parsed.id,
            ok: true,
            result: {
              protocolVersion: internalProtocolVersion,
              role: "extension",
              capabilities: []
            }
          })}\n`
        );
        continue;
      }
      expect(parsed.method).toBe("scheduler.tool");
      respond(parsed.id);
    }
  });
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  for (const socket of serverSockets.get(server) ?? []) {
    socket.destroy();
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
