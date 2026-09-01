import { createServer, type Server, type Socket } from "node:net";
import { timingSafeEqual } from "node:crypto";
import { chmod, lstat, readdir, unlink, writeFile } from "node:fs/promises";
import { relative } from "node:path";
import type { PiWebConfig, PiWebPaths } from "@pi-web/config";
import { loadConfig, saveConfig } from "@pi-web/config";
import {
  authRotateSchema,
  internalProtocolVersion,
  ipcContract,
  isInternalMessage,
  isIpcMethod,
  maxPromptRequestBytes,
  settingsUpdateSchema,
  type AccessKeyHash,
  type AuthRotateResult,
  type DirectoryBrowseResult,
  type InternalRequest,
  type InternalResponse,
  type IpcMethodResult,
  type NotificationRecord,
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
import { LfJsonlDecoder, encodeJsonl } from "@pi-web/ipc";
import { z } from "zod";
import { AuditStore } from "./audit-store.js";
import { AuthStore } from "./auth-store.js";
import { DashboardReader } from "./dashboard-reader.js";
import { DirectoryStore } from "./directory-store.js";
import type { IpcHandlerMap, ServerIpcMethod } from "./ipc-handler.js";
import { createNotificationHandlers } from "./ipc-notification-handlers.js";
import { asRecord, optionalString, stringParam } from "./ipc-params.js";
import { createScheduleHandlers } from "./ipc-schedule-handlers.js";
import { createSessionHandlers } from "./ipc-session-handlers.js";
import { NotificationCenter } from "./notification-center.js";
import { NotificationStore } from "./notification-store.js";
import { PiManager } from "./pi-manager.js";
import { Scheduler } from "./scheduler.js";
import { SessionFolderStore } from "./session-folders.js";
import { SettingsStore } from "./settings-store.js";
import { SessionSupervisor } from "./supervisor.js";

export type IpcRole = "unknown" | "server" | "extension";

interface Connection {
  socket: Socket;
  role: IpcRole;
  handshaken: boolean;
}

type CoreMethod = Exclude<
  ServerIpcMethod,
  | `sessions.${string}`
  | `session_folders.${string}`
  | `schedules.${string}`
  | "scheduler.tool"
  | `notifications.${string}`
  | `push.${string}`
>;

export class IpcServer {
  readonly #paths: PiWebPaths;
  #config: PiWebConfig;
  readonly #audit: AuditStore;
  readonly #auth: AuthStore;
  readonly #dashboard: DashboardReader;
  readonly #directories: DirectoryStore;
  readonly #notificationStore: NotificationStore;
  readonly #settings: SettingsStore;
  readonly #supervisor: SessionSupervisor;
  readonly #scheduler: Scheduler;
  readonly #piManager: PiManager;
  readonly #sessionFolders: SessionFolderStore;
  readonly #notifications: NotificationCenter;
  readonly #handlers: IpcHandlerMap;
  readonly #connections = new Set<Connection>();
  readonly #inFlight = new Set<Promise<void>>();
  readonly #serverToken = generateSessionToken();
  #server: Server | null = null;
  #stopping = false;
  #stopPromise: Promise<void> | null = null;

  constructor(options: {
    paths: PiWebPaths;
    config: PiWebConfig;
    audit: AuditStore;
    auth: AuthStore;
    dashboard: DashboardReader;
    directories: DirectoryStore;
    notificationStore: NotificationStore;
    settings: SettingsStore;
    supervisor: SessionSupervisor;
    scheduler: Scheduler;
    piManager: PiManager;
    sessionFolders: SessionFolderStore;
    notifications: NotificationCenter;
  }) {
    this.#paths = options.paths;
    this.#config = options.config;
    this.#audit = options.audit;
    this.#auth = options.auth;
    this.#dashboard = options.dashboard;
    this.#directories = options.directories;
    this.#notificationStore = options.notificationStore;
    this.#settings = options.settings;
    this.#supervisor = options.supervisor;
    this.#scheduler = options.scheduler;
    this.#piManager = options.piManager;
    this.#sessionFolders = options.sessionFolders;
    this.#notifications = options.notifications;
    this.#handlers = {
      ...this.#coreHandlers(),
      ...createSessionHandlers(this.#supervisor, this.#sessionFolders),
      ...createScheduleHandlers(this.#scheduler, this.#supervisor),
      ...createNotificationHandlers(
        this.#notifications,
        this.#notificationStore
      )
    };
    this.#supervisor.on("event", (event: RealtimeEvent) => this.#broadcast(event));
    this.#notifications.on("notification", (notification: NotificationRecord) =>
      this.#broadcastNotification(notification)
    );
    this.#notifications.on("refresh", () => this.#broadcastNotificationRefresh());
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
    const connection: Connection = {
      socket,
      role: "unknown",
      handshaken: false
    };
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
      if (request.protocolVersion !== internalProtocolVersion) {
        throw new PiWebError(
          "IPC_PROTOCOL_VERSION_MISMATCH",
          `IPC protocol ${request.protocolVersion} is unsupported; expected ${internalProtocolVersion}`,
          409
        );
      }
      if (!connection.handshaken) {
        if (request.method !== "protocol.handshake") {
          throw new PiWebError(
            "IPC_HANDSHAKE_REQUIRED",
            "IPC protocol handshake is required before business requests",
            409
          );
        }
        const requestedRole = stringParam(asRecord(request.params), "role");
        if (requestedRole === "server") {
          connection.role = authorizeIpcRequest(
            connection.role,
            request,
            this.#serverToken
          );
        } else if (requestedRole === "extension") {
          connection.role = "extension";
        } else {
          throw new PiWebError("IPC_ROLE_INVALID", "Invalid IPC client role", 400);
        }
        connection.handshaken = true;
        this.#write(connection, {
          kind: "response",
          id: request.id,
          ok: true,
          result: {
            protocolVersion: internalProtocolVersion,
            role: connection.role,
            capabilities: [
              "projection_epoch",
              "extension_ui",
              "entry_cursor",
              "notification_inbox",
              "web_push"
            ]
          }
        });
        return;
      }
      if (!isIpcMethod(request.method)) {
        throw new PiWebError(
          "METHOD_NOT_FOUND",
          `Unknown IPC method: ${request.method}`,
          404
        );
      }
      if (request.method === "protocol.handshake") {
        throw new PiWebError(
          "IPC_ALREADY_HANDSHAKEN",
          "IPC connection has already completed its handshake",
          409
        );
      }
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

  async #dispatch<M extends ServerIpcMethod>(
    method: M,
    raw: unknown
  ): Promise<IpcMethodResult<M>> {
    return await this.#handlers[method](raw);
  }

  #coreHandlers(): IpcHandlerMap<CoreMethod> {
    return {
      health: () => ({
        ok: true,
        pid: process.pid,
        now: nowIso(),
        activeWorkers: this.#supervisor.activeCount
      }),
      "service.prepare_change": (raw) => {
        const params = asRecord(raw);
        const action = z
          .enum(["stop", "restart", "uninstall"])
          .parse(params.action);
        const result = this.#supervisor.prepareServiceChange(
          params.force === true
        );
        if (result.forced) {
          this.#audit.write("service.force_change", "success", "cli", null, {
            action,
            activeWorkers: result.activeWorkers
          });
        }
        return result;
      },
      "service.cancel_change": () => {
        this.#supervisor.cancelServiceChange();
        return { cancelled: true };
      },
      dashboard: () => this.#dashboard.get(),
      "directories.list": () => this.#directories.list(),
      "directories.favorite": (raw) => {
        const params = asRecord(raw);
        this.#directories.setFavorite(
          stringParam(params, "path"),
          params.favorite === true,
          optionalString(params.alias)
        );
        return this.#directories.list();
      },
      "directories.browse": async (raw) => {
        const params = asRecord(raw);
        return await this.#browseDirectory(
          stringParam(params, "root"),
          optionalString(params.path) ?? ""
        );
      },
      "pi.status": async () => await this.#piManager.status(),
      "pi.update_status": async (raw) =>
        await this.#piManager.updateStatus(Boolean(asRecord(raw).force)),
      "pi.package": async (raw) => {
        const params = asRecord(raw);
        const action = z
          .enum(["install", "remove", "update_all"])
          .parse(params.action);
        const authorization = this.#supervisor.preparePackageChange(
          params.force === true
        );
        if (authorization.forced) {
          this.#audit.write("package.force", "success", "web", null, {
            activeWorkers: authorization.activeWorkers,
            action
          });
        }
        try {
          const source = optionalString(params.source);
          return await this.#piManager.packageOperation({
            action,
            ...(source === null ? {} : { source }),
            actor: "web"
          });
        } finally {
          this.#supervisor.finishPackageChange();
        }
      },
      "settings.get": () => this.#config,
      "settings.update": async (raw) =>
        await this.#updateSettings(asRecord(raw)),
      "auth.get_hash": () =>
        this.#settings.get<AccessKeyHash>("access_key_hash"),
      "auth.set_hash": (raw) => {
        const params = asRecord(raw);
        this.#settings.set("access_key_hash", params.hash);
        this.#audit.write("access_key.set", "success", "system");
        return { updated: true };
      },
      "auth.rotate": (raw) => {
        this.#auth.rotateAccessKey(authRotateSchema.parse(asRecord(raw)));
        return { updated: true } satisfies AuthRotateResult;
      },
      "auth.get_sessions": () => this.#settings.get("auth_sessions"),
      "auth.set_sessions": (raw) => {
        this.#settings.set("auth_sessions", asRecord(raw).sessions);
        return { updated: true };
      },
      "audit.login": (raw) => {
        const params = asRecord(raw);
        this.#audit.write(
          "login",
          params.success ? "success" : "failure",
          "web",
          null,
          { remote: optionalString(params.remote) }
        );
        return { recorded: true };
      },
      doctor: async () => ({
        database: true,
        socket: this.#paths.socketPath,
        scheduler: true,
        activeWorkers: this.#supervisor.activeCount,
        pi: await this.#piManager.doctorProbe()
      } satisfies SessiondDoctorResult)
    };
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
    this.#audit.write("settings.update", "success", "web", null, {
      keys: Object.keys(patch)
    });
    return this.#config;
  }

  async #browseDirectory(
    root: string,
    relativePath: string
  ): Promise<DirectoryBrowseResult> {
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

  #broadcastNotification(notification: NotificationRecord): void {
    const encoded = encodeJsonl({ kind: "notification", notification });
    for (const connection of this.#connections) {
      if (connection.role === "server" && connection.socket.writable) {
        connection.socket.write(encoded);
      }
    }
  }

  #broadcastNotificationRefresh(): void {
    const encoded = encodeJsonl({ kind: "notification_refresh" });
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
  if (
    isIpcMethod(request.method) &&
    ipcContract[request.method].role === "extension"
  ) {
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
