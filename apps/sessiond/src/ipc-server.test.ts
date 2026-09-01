import { EventEmitter, once } from "node:events";
import { mkdtemp, readFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ensureDirectories,
  loadConfig,
  resolvePaths
} from "@pi-web/config";
import {
  authRotateSchema,
  internalProtocolVersion,
  isInternalMessage,
  type InternalRequest
} from "@pi-web/protocol";
import { encodeJsonl, LfJsonlDecoder } from "@pi-web/ipc";
import { PiWebError } from "@pi-web/shared";
import { z } from "zod";
import {
  authorizeIpcRequest,
  IpcServer,
  toInternalResponseError
} from "./ipc-server.js";

function request(
  method: string,
  token?: string
): InternalRequest {
  return {
    kind: "request",
    protocolVersion: internalProtocolVersion,
    id: "request-1",
    method,
    ...(token
      ? { auth: { role: "server" as const, token } }
      : {})
  };
}

describe("IPC connection authorization", () => {
  const serverToken = "server-only-token";

  it("rejects server methods until the connection presents the server token", () => {
    expect(() =>
      authorizeIpcRequest("unknown", request("sessions.list"), serverToken)
    ).toThrowError(expect.objectContaining({ code: "IPC_AUTH_REQUIRED" }));
    expect(() =>
      authorizeIpcRequest(
        "unknown",
        request("sessions.list", "wrong-token"),
        serverToken
      )
    ).toThrowError(expect.objectContaining({ code: "IPC_AUTH_REQUIRED" }));
    expect(
      authorizeIpcRequest(
        "unknown",
        request("sessions.list", serverToken),
        serverToken
      )
    ).toBe("server");
  });

  it("keeps authenticated extension connections limited to scheduler tools", () => {
    expect(
      authorizeIpcRequest("unknown", request("scheduler.tool"), serverToken)
    ).toBe("extension");
    expect(() =>
      authorizeIpcRequest("extension", request("sessions.list"), serverToken)
    ).toThrowError(expect.objectContaining({ code: "IPC_ROLE_FORBIDDEN" }));
    expect(
      authorizeIpcRequest("extension", request("scheduler.tool"), serverToken)
    ).toBe("extension");
  });

  it("prevents server connections from switching into the extension role", () => {
    expect(() =>
      authorizeIpcRequest("server", request("scheduler.tool"), serverToken)
    ).toThrowError(expect.objectContaining({ code: "IPC_ROLE_FORBIDDEN" }));
  });
});

describe("IPC error envelope", () => {
  it.each([
    ["SESSION_NOT_FOUND", 404],
    ["SESSION_BUSY", 409],
    ["MUTATION_ID_REUSED", 409],
    ["WORKER_LIMIT", 429]
  ])("preserves %s as HTTP %i", (code, statusCode) => {
    expect(
      toInternalResponseError(new PiWebError(code, "known failure", statusCode))
    ).toEqual({
      code,
      message: "known failure",
      statusCode
    });
  });

  it("redacts unknown failures behind a generic HTTP 500", () => {
    expect(
      toInternalResponseError(new Error("sqlite path and query details"))
    ).toEqual({
      code: "INTERNAL_ERROR",
      message: "Internal server error",
      statusCode: 500
    });
  });

  it("maps schema failures to a safe HTTP 400 envelope", () => {
    const parsed = z
      .object({ secret: z.string().min(10) })
      .safeParse({ secret: "raw-key" });
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error("Expected schema validation to fail");
    const validationError = parsed.error;

    expect(toInternalResponseError(validationError)).toEqual({
      code: "VALIDATION_ERROR",
      message: "IPC request validation failed",
      statusCode: 400
    });
    expect(JSON.stringify(toInternalResponseError(validationError))).not.toContain(
      "raw-key"
    );
  });
});

describe("auth.rotate IPC input", () => {
  it("accepts only supported key hashes and audit event types", () => {
    expect(
      authRotateSchema.parse({
        hash: {
          algorithm: "scrypt",
          salt: "salt",
          hash: "hash"
        },
        auditType: "access_key.reset",
        actor: "web"
      })
    ).toEqual({
      hash: {
        algorithm: "scrypt",
        salt: "salt",
        hash: "hash"
      },
      auditType: "access_key.reset",
      actor: "web"
    });
    expect(() =>
      authRotateSchema.parse({
        hash: {
          algorithm: "plain",
          salt: "",
          hash: "secret"
        },
        auditType: "arbitrary.audit",
        actor: "system"
      })
    ).toThrow();
    expect(() =>
      authRotateSchema.parse({
        hash: {
          algorithm: "scrypt",
          salt: "salt",
          hash: "hash"
        },
        auditType: "access_key.reset",
        actor: "system"
      })
    ).toThrow();
  });
});

describe("IPC shutdown", () => {
  it("waits for an accepted handler before stop resolves", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-ipc-drain-"));
    const env = {
      ...process.env,
      PI_WEB_CONFIG_DIR: join(root, "config"),
      PI_WEB_DATA_DIR: join(root, "data"),
      PI_WEB_CACHE_DIR: join(root, "cache")
    };
    const paths = resolvePaths(env);
    await ensureDirectories(paths);
    const config = await loadConfig(
      { allowedRoots: [root], allowAnyDirectory: true },
      env
    );
    let markHandlerStarted!: () => void;
    const handlerStarted = new Promise<void>((resolve) => {
      markHandlerStarted = resolve;
    });
    let releaseHandler!: () => void;
    const handlerResult = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    class DeferredSupervisor extends EventEmitter {
      readonly activeCount = 0;
      async snapshot(): Promise<Record<string, never>> {
        markHandlerStarted();
        await handlerResult;
        return {};
      }
    }
    const supervisor = new DeferredSupervisor();
    const ipc = new IpcServer({
      paths,
      config,
      audit: {} as never,
      auth: {} as never,
      dashboard: {} as never,
      directories: {} as never,
      notificationStore: {} as never,
      settings: {} as never,
      supervisor: supervisor as never,
      scheduler: {} as never,
      piManager: {} as never,
      sessionFolders: {} as never,
      notifications: new EventEmitter() as never
    });
    let socket: ReturnType<typeof createConnection> | null = null;
    try {
      await ipc.start();
      const token = (await readFile(paths.ipcTokenFile, "utf8")).trim();
      socket = createConnection(paths.socketPath);
      await once(socket, "connect");
      const requestResult = new Promise<unknown>((resolve, reject) => {
        const decoder = new LfJsonlDecoder({
          onValue: (value) => {
            if (
              isInternalMessage(value) &&
              value.kind === "response" &&
              value.id === "request-1"
            ) {
              resolve(value);
            }
          },
          onError: reject
        });
        socket!.on("data", (chunk) => decoder.push(chunk));
        socket!.once("close", () =>
          reject(new Error("IPC connection closed"))
        );
      }).catch((error) => error);
      socket.write(
        encodeJsonl({
          kind: "request",
          protocolVersion: internalProtocolVersion,
          id: "handshake-1",
          method: "protocol.handshake",
          params: { role: "server" },
          auth: { role: "server", token }
        })
      );
      await new Promise<void>((resolve, reject) => {
        const decoder = new LfJsonlDecoder({
          onValue: (value) => {
            if (
              isInternalMessage(value) &&
              value.kind === "response" &&
              value.id === "handshake-1" &&
              value.ok
            ) {
              resolve();
            }
          },
          onError: reject
        });
        socket!.once("data", (chunk) => decoder.push(chunk));
      });
      socket.write(
        encodeJsonl({
          kind: "request",
          protocolVersion: internalProtocolVersion,
          id: "request-1",
          method: "sessions.snapshot",
          params: { id: "session-1" },
          auth: { role: "server", token }
        })
      );
      await handlerStarted;

      let stopSettled = false;
      const stopping = ipc.stop().then(() => {
        stopSettled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(stopSettled).toBe(false);

      releaseHandler();
      await stopping;
      expect(await requestResult).toBeInstanceOf(Error);
    } finally {
      releaseHandler();
      socket?.destroy();
      await ipc.stop();
    }
  });
});
