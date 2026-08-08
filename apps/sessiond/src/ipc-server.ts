import { createServer, type Server, type Socket } from "node:net";
import { timingSafeEqual } from "node:crypto";
import { chmod, lstat, readdir, unlink, writeFile } from "node:fs/promises";
import { relative } from "node:path";
import type { PiWebConfig, PiWebPaths } from "@pi-web/config";
import { loadConfig, publicConfig, saveConfig } from "@pi-web/config";
import {
  authRotateSchema,
  createSessionSchema,
  isInternalMessage,
  maxPromptRequestBytes,
  promptSchema,
  resumeSessionSchema,
  sessionRenameSchema,
  settingsUpdateSchema,
  type AuthRotateResult,
  type InternalRequest,
  type InternalResponse,
  type RealtimeEvent,
  type SessiondDoctorResult
} from "@pi-web/protocol";
import {
  nowIso,
  generateSessionToken,
  PiWebError,
  redact,
  resolveAllowedDirectory,
  resolveContainedPath
} from "@pi-web/shared";
import { LfJsonlDecoder, encodeJsonl } from "@pi-web/pi-rpc";
import { z } from "zod";
import { SessionDatabase } from "./database.js";
import { PiManager } from "./pi-manager.js";
import { Scheduler } from "./scheduler.js";
import { SessionFolderStore } from "./session-folders.js";
import { SessionSupervisor } from "./supervisor.js";

export type IpcRole = "unknown" | "server" | "extension";

interface Connection {
  socket: Socket;
  role: IpcRole;
}

export class IpcServer {
  readonly #paths: PiWebPaths;
  #config: PiWebConfig;
  readonly #db: SessionDatabase;
  readonly #supervisor: SessionSupervisor;
  readonly #scheduler: Scheduler;
  readonly #piManager: PiManager;
  readonly #sessionFolders: SessionFolderStore;
  readonly #connections = new Set<Connection>();
  readonly #inFlight = new Set<Promise<void>>();
  readonly #serverToken = generateSessionToken();
  #server: Server | null = null;
  #stopping = false;
  #stopPromise: Promise<void> | null = null;

  constructor(options: {
    paths: PiWebPaths;
    config: PiWebConfig;
    db: SessionDatabase;
    supervisor: SessionSupervisor;
    scheduler: Scheduler;
    piManager: PiManager;
    sessionFolders: SessionFolderStore;
  }) {
    this.#paths = options.paths;
    this.#config = options.config;
    this.#db = options.db;
    this.#supervisor = options.supervisor;
    this.#scheduler = options.scheduler;
    this.#piManager = options.piManager;
    this.#sessionFolders = options.sessionFolders;
    this.#supervisor.on("event", (event: RealtimeEvent) => this.#broadcast(event));
  }

  async start(): Promise<void> {
    await this.#removeStaleSocket();
    await writeFile(this.#paths.ipcTokenFile, `${this.#serverToken}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    if (process.platform !== "win32") {
      await chmod(this.#paths.ipcTokenFile, 0o600);
    }
    const server = createServer((socket) => this.#accept(socket));
    this.#server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.#paths.socketPath, () => {
        server.off("error", reject);
        resolve();
      });
    });
    if (process.platform !== "win32") {
      await chmod(this.#paths.socketPath, 0o600);
    }
  }

  stop(): Promise<void> {
    this.#stopPromise ??= this.#stop();
    return this.#stopPromise;
  }

  async #stop(): Promise<void> {
    this.#stopping = true;
    for (const connection of this.#connections) connection.socket.destroy();
    this.#connections.clear();
    if (this.#server) {
      await new Promise<void>((resolve) => this.#server!.close(() => resolve()));
      this.#server = null;
    }
    while (this.#inFlight.size > 0) {
      await Promise.allSettled([...this.#inFlight]);
    }
    if (process.platform !== "win32") {
      await unlink(this.#paths.socketPath).catch(() => undefined);
    }
    await unlink(this.#paths.ipcTokenFile).catch(() => undefined);
  }

  #accept(socket: Socket): void {
    if (this.#stopping) {
      socket.destroy();
      return;
    }
    socket.setNoDelay(true);
    const connection: Connection = { socket, role: "unknown" };
    this.#connections.add(connection);
    const decoder = new LfJsonlDecoder({
      maxLineBytes: maxPromptRequestBytes,
      onValue: (value) => {
        if (!isInternalMessage(value) || value.kind !== "request") {
          this.#write(connection, {
            kind: "response",
            id: "unknown",
            ok: false,
            error: {
              code: "INVALID_REQUEST",
              message: "Invalid IPC request",
              statusCode: 400
            }
          });
          return;
        }
        if (this.#stopping) return;
        const handling = this.#handle(connection, value);
        this.#inFlight.add(handling);
        void handling
          .finally(() => this.#inFlight.delete(handling))
          .catch(() => undefined);
      },
      onError: (_error) => {
        this.#write(connection, {
          kind: "response",
          id: "unknown",
          ok: false,
          error: {
            code: "INVALID_JSON",
            message: "Invalid IPC JSON",
            statusCode: 400
          }
        });
        connection.socket.end();
      }
    });
    socket.on("data", (chunk) => decoder.push(chunk));
    socket.on("end", () => decoder.end());
    socket.on("close", () => this.#connections.delete(connection));
    socket.on("error", () => this.#connections.delete(connection));
  }

  async #handle(connection: Connection, request: InternalRequest): Promise<void> {
    try {
      const authorizedRole = authorizeIpcRequest(
        connection.role,
        request,
        this.#serverToken
      );
      if (authorizedRole === "server") connection.role = "server";
      const result = await this.#dispatch(request.method, request.params);
      if (authorizedRole === "extension") connection.role = "extension";
      this.#write(connection, {
        kind: "response",
        id: request.id,
        ok: true,
        result
      });
    } catch (error) {
      this.#write(connection, {
        kind: "response",
        id: request.id,
        ok: false,
        error: toInternalResponseError(error)
      });
    }
  }

  async #dispatch(method: string, raw: unknown): Promise<unknown> {
    const params = asRecord(raw);
    switch (method) {
      case "health":
        return {
          ok: true,
          pid: process.pid,
          now: nowIso(),
          activeWorkers: this.#supervisor.activeCount
        };
      case "dashboard":
        return this.#db.dashboard();
      case "sessions.list":
        return this.#supervisor.list();
      case "sessions.get":
        return this.#supervisor.get(stringParam(params, "id"));
      case "sessions.rename": {
        const input = sessionRenameSchema.parse(params);
        return await this.#supervisor.rename(
          stringParam(params, "id"),
          input.displayName
        );
      }
      case "sessions.pin":
        return this.#supervisor.pin(
          stringParam(params, "id"),
          z.boolean().parse(params.pinned)
        );
      case "sessions.delete": {
        const id = stringParam(params, "id");
        this.#supervisor.assertDeletable(id);
        this.#db.transaction(() => {
          this.#sessionFolders.assign(id, { folderId: null });
          this.#supervisor.delete(id);
        });
        return { deleted: true };
      }
      case "sessions.create": {
        const input = createSessionSchema.parse(params);
        return await this.#supervisor.create({
          ...(input.mutationId === undefined
            ? {}
            : { mutationId: input.mutationId }),
          cwd: input.cwd,
          displayName: input.displayName,
          ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
          ...(input.images.length === 0 ? {} : { images: input.images }),
          ...(input.model === undefined ? {} : { model: input.model }),
          ...(input.thinkingLevel === undefined
            ? {}
            : { thinkingLevel: input.thinkingLevel }),
          ...(input.systemPrompt === undefined
            ? {}
            : { systemPrompt: input.systemPrompt }),
          createdBy: "web"
        });
      }
      case "sessions.resume": {
        const input = resumeSessionSchema.parse(params);
        return await this.#supervisor.resume(
          stringParam(params, "id"),
          input.prompt,
          input.images,
          input.mutationId
        );
      }
      case "sessions.prompt": {
        const input = promptSchema.parse(params);
        await this.#supervisor.prompt(
          stringParam(params, "id"),
          input.message,
          input.behavior,
          input.images,
          input.mutationId
        );
        return { accepted: true };
      }
      case "sessions.abort":
        await this.#supervisor.abort(stringParam(params, "id"));
        return { accepted: true };
      case "sessions.close":
        await this.#supervisor.close(stringParam(params, "id"));
        return { closed: true };
      case "sessions.model":
        await this.#supervisor.setModel(
          stringParam(params, "id"),
          stringParam(params, "model")
        );
        return { updated: true };
      case "sessions.thinking":
        await this.#supervisor.setThinkingLevel(
          stringParam(params, "id"),
          stringParam(params, "thinkingLevel") as never
        );
        return { updated: true };
      case "sessions.snapshot":
        return await this.#supervisor.snapshot(
          stringParam(params, "id"),
          optionalString(params.cursor)
        );
      case "sessions.sync":
        return await this.#supervisor.sync(
          stringParam(params, "id"),
          numberParam(params, "afterSequence", 0)
        );
      case "session_folders.get":
        return this.#sessionFolders.get();
      case "session_folders.create":
        return this.#sessionFolders.create(params);
      case "session_folders.rename":
        return this.#sessionFolders.rename(
          stringParam(params, "id"),
          params
        );
      case "session_folders.remove":
        return this.#sessionFolders.remove(stringParam(params, "id"));
      case "session_folders.assign":
        return this.#sessionFolders.assign(
          stringParam(params, "sessionId"),
          params
        );
      case "directories.list":
        return this.#db.listDirectories();
      case "directories.favorite":
        this.#db.setDirectoryFavorite(
          stringParam(params, "path"),
          Boolean(params.favorite),
          optionalString(params.alias)
        );
        return this.#db.listDirectories();
      case "directories.browse":
        return await this.#browseDirectory(
          stringParam(params, "root"),
          optionalString(params.path) ?? ""
        );
      case "schedules.list":
        return this.#scheduler.list();
      case "schedules.get":
        return this.#scheduler.get(stringParam(params, "id"));
      case "schedules.runs":
        return this.#scheduler.runs(optionalString(params.jobId) ?? undefined);
      case "schedules.create":
        return await this.#scheduler.create(params, { actor: "web" });
      case "schedules.update":
        return await this.#scheduler.update(
          stringParam(params, "id"),
          params,
          "web"
        );
      case "schedules.enable":
        return this.#scheduler.setEnabled(
          stringParam(params, "id"),
          Boolean(params.enabled),
          "web"
        );
      case "schedules.delete":
        return this.#scheduler.delete(stringParam(params, "id"), "web");
      case "schedules.run_now":
        return await this.#scheduler.runNow(stringParam(params, "id"), "web");
      case "scheduler.tool":
        return await this.#schedulerTool(params);
      case "pi.status":
        return await this.#piManager.status();
      case "pi.package":
        return await this.#piManager.packageOperation({
          action: stringParam(params, "action") as
            | "install"
            | "remove"
            | "update_all",
          ...(optionalString(params.source) === null
            ? {}
            : { source: optionalString(params.source) as string }),
          actor: "web"
        });
      case "settings.get":
        return publicConfig(this.#config);
      case "settings.update":
        return await this.#updateSettings(params);
      case "auth.get_hash":
        return this.#db.getSetting("access_key_hash");
      case "auth.set_hash":
        this.#db.setSetting("access_key_hash", params.hash);
        this.#db.audit("access_key.set", "success", "system");
        return { updated: true };
      case "auth.rotate": {
        const input = authRotateSchema.parse(params);
        this.#db.rotateAccessKey(input);
        return { updated: true } satisfies AuthRotateResult;
      }
      case "auth.get_sessions":
        return this.#db.getSetting("auth_sessions");
      case "auth.set_sessions":
        this.#db.setSetting("auth_sessions", params.sessions);
        return { updated: true };
      case "audit.login":
        this.#db.audit(
          "login",
          params.success ? "success" : "failure",
          "web",
          null,
          { remote: optionalString(params.remote) }
        );
        return { recorded: true };
      case "doctor":
        return {
          database: true,
          socket: this.#paths.socketPath,
          scheduler: true,
          activeWorkers: this.#supervisor.activeCount,
          pi: await this.#piManager.doctorProbe()
        } satisfies SessiondDoctorResult;
      default:
        throw new PiWebError("METHOD_NOT_FOUND", `Unknown IPC method: ${method}`, 404);
    }
  }

  async #schedulerTool(params: Record<string, unknown>): Promise<unknown> {
    const token = stringParam(params, "token");
    const sessionId = stringParam(params, "sessionId");
    if (this.#supervisor.getWorkerSessionForToken(token) !== sessionId) {
      throw new PiWebError(
        "INVALID_WORKER_TOKEN",
        "Scheduler worker token is invalid or expired",
        403
      );
    }
    return await this.#scheduler.tool(asRecord(params.input), sessionId);
  }

  async #updateSettings(params: Record<string, unknown>): Promise<PiWebConfig> {
    const patch = settingsUpdateSchema.parse(params);
    const cleanPatch = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined)
    ) as Partial<PiWebConfig>;
    if (cleanPatch.allowedRoots) {
      cleanPatch.allowedRoots = await Promise.all(
        cleanPatch.allowedRoots.map((root) =>
          resolveAllowedDirectory(root, [root], true)
        )
      );
    }
    if (cleanPatch.defaultTimezone) {
      try {
        new Intl.DateTimeFormat("en", {
          timeZone: cleanPatch.defaultTimezone
        }).format();
      } catch {
        throw new PiWebError(
          "INVALID_TIMEZONE",
          "Default timezone must be a valid IANA name",
          400
        );
      }
    }
    if (
      cleanPatch.defaultModel &&
      !/^[^/\s]+\/[^/\s].+$/.test(cleanPatch.defaultModel)
    ) {
      throw new PiWebError(
        "INVALID_MODEL",
        "Default model must be provider/model-id",
        400
      );
    }
    const merged: PiWebConfig = { ...this.#config, ...cleanPatch };
    await saveConfig(merged, this.#paths);
    // Re-read without explicit overrides so environment values retain their
    // documented precedence over the saved file.
    this.#config = await loadConfig();
    this.#supervisor.updateConfig(this.#config);
    this.#scheduler.updateConfig(this.#config);
    this.#piManager.updateConfig(this.#config);
    this.#db.audit("settings.update", "success", "web", null, {
      keys: Object.keys(patch)
    });
    return publicConfig(this.#config);
  }

  async #browseDirectory(root: string, relativePath: string): Promise<unknown> {
    if (!this.#config.allowedRoots.includes(root)) {
      throw new PiWebError("ROOT_NOT_ALLOWED", "Unknown allowed root", 403);
    }
    const target = await resolveContainedPath(root, relativePath);
    const entries = await readdir(target, { withFileTypes: true });
    return {
      root,
      path: relative(root, target),
      absolutePath: target,
      entries: entries
        .filter((entry) => entry.isDirectory())
        .slice(0, 500)
        .map((entry) => ({
          name: entry.name,
          path: relative(root, `${target}/${entry.name}`),
          directory: true
        }))
    };
  }

  #write(connection: Connection, message: InternalResponse): void {
    if (connection.socket.writable) connection.socket.write(encodeJsonl(message));
  }

  #broadcast(event: RealtimeEvent): void {
    const encoded = encodeJsonl({ kind: "event", event });
    for (const connection of this.#connections) {
      if (connection.role === "server" && connection.socket.writable) {
        connection.socket.write(encoded);
      }
    }
  }

  async #removeStaleSocket(): Promise<void> {
    if (process.platform === "win32") return;
    const info = await lstat(this.#paths.socketPath).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    );
    if (!info) return;
    if (!info.isSocket()) {
      throw new PiWebError(
        "SOCKET_PATH_OCCUPIED",
        "Session daemon socket path exists and is not a socket",
        500
      );
    }
    await unlink(this.#paths.socketPath);
  }
}

export function toInternalResponseError(
  error: unknown
): NonNullable<InternalResponse["error"]> {
  if (error instanceof z.ZodError) {
    return {
      code: "VALIDATION_ERROR",
      message: "IPC request validation failed",
      statusCode: 400
    };
  }
  if (!(error instanceof PiWebError)) {
    return {
      code: "INTERNAL_ERROR",
      message: "Internal server error",
      statusCode: 500
    };
  }
  return {
    code: error.code,
    message: error.message,
    statusCode: normalizeErrorStatus(error.statusCode),
    ...(error.details === undefined ? {} : { details: redact(error.details) })
  };
}

function normalizeErrorStatus(statusCode: number): number {
  return Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599
    ? statusCode
    : 500;
}

export function authorizeIpcRequest(
  currentRole: IpcRole,
  request: InternalRequest,
  serverToken: string
): Exclude<IpcRole, "unknown"> {
  if (request.method === "scheduler.tool") {
    if (currentRole === "server") {
      throw new PiWebError(
        "IPC_ROLE_FORBIDDEN",
        "The server connection cannot invoke extension-only methods",
        403
      );
    }
    return "extension";
  }
  if (currentRole === "extension") {
    throw new PiWebError(
      "IPC_ROLE_FORBIDDEN",
      "The extension connection cannot invoke server methods",
      403
    );
  }
  if (currentRole === "server") return "server";
  if (
    request.auth?.role === "server" &&
    typeof request.auth.token === "string" &&
    tokensMatch(request.auth.token, serverToken)
  ) {
    return "server";
  }
  throw new PiWebError(
    "IPC_AUTH_REQUIRED",
    "Server IPC authentication is required",
    403
  );
}

function tokensMatch(candidate: string, expected: string): boolean {
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  return (
    candidateBuffer.length === expectedBuffer.length &&
    timingSafeEqual(candidateBuffer, expectedBuffer)
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function stringParam(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value) {
    throw new PiWebError("INVALID_PARAMETER", `${key} is required`, 400);
  }
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberParam(
  record: Record<string, unknown>,
  key: string,
  fallback: number
): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
