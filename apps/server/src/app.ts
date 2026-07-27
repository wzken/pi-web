import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, {
  type FastifyInstance,
  type FastifyRequest
} from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import type { PiWebConfig, PiWebPaths } from "@pi-web/config";
import {
  browserSocketMessageSchema,
  createSessionSchema,
  jobInputSchema,
  maxPromptRequestBytes,
  promptSchema,
  resumeSessionSchema,
  sessionRenameSchema,
  settingsUpdateSchema,
  thinkingLevels,
  type RealtimeEvent,
  type SessionSnapshot
} from "@pi-web/protocol";
import { PiWebError, safeErrorMessage } from "@pi-web/shared";
import { z } from "zod";
import { AuthManager, shouldUseSecureCookie } from "./auth.js";
import { registerFileRoutes } from "./files.js";
import { SessionFolderStore } from "./session-folders.js";
import { SessiondClient } from "./sessiond-client.js";
import { registerThemeRoutes } from "./themes.js";
import { registerTerminalRoutes } from "./terminal.js";

const idSchema = z.string().uuid();
export async function createServer(options: {
  config: PiWebConfig;
  paths: PiWebPaths;
  client: SessiondClient;
  auth: AuthManager;
}): Promise<FastifyInstance> {
  let config = options.config;
  const { client, auth } = options;
  const sessionFolders = new SessionFolderStore(options.paths);
  const app = Fastify({
    logger: {
      level: process.env.PI_WEB_LOG_LEVEL || "info",
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "res.headers.set-cookie",
        "body.key",
        "body.token"
      ]
    },
    trustProxy: config.trustedProxy,
    bodyLimit: maxPromptRequestBytes
  });

  await app.register(cookie);
  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:", "http:", "https:"],
        fontSrc: ["'self'", "data:"],
        mediaSrc: ["'self'", "blob:"],
        connectSrc: ["'self'", "ws:", "wss:"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"]
      }
    },
    crossOriginEmbedderPolicy: false
  });
  await app.register(websocket, {
    options: { maxPayload: 1024 * 1024 }
  });

  app.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?")[0] ?? request.url;
    if (!path.startsWith("/api/")) return;
    if (
      path === "/api/health" ||
      path === "/api/auth/login" ||
      path === "/api/themes" ||
      path.startsWith("/api/theme-assets/")
    ) {
      return;
    }
    if (!auth.validate(request.cookies.pi_web_session)) {
      return reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "Sign in required" } });
    }
  });

  app.addHook("preValidation", async (request, reply) => {
    const path = request.url.split("?")[0] ?? request.url;
    if (!path.startsWith("/api/")) return;
    const writes = !["GET", "HEAD", "OPTIONS"].includes(request.method);
    const isWebSocket = path === "/api/ws" || path === "/api/terminal";
    if ((writes || isWebSocket) && !originMatches(request)) {
      return reply.code(403).send({
        error: { code: "ORIGIN_REJECTED", message: "Request Origin does not match this Pi Web host" }
      });
    }
  });

  app.setErrorHandler((error, request, reply) => {
    const known = error instanceof PiWebError ? error : null;
    const validation = error instanceof z.ZodError ? error : null;
    const statusCode = known?.statusCode ?? (validation ? 400 : 500);
    if (statusCode >= 500) request.log.error({ err: error }, "request failed");
    void reply.code(statusCode).send({
      error: {
        code: known?.code ?? (validation ? "VALIDATION_ERROR" : "INTERNAL_ERROR"),
        message:
          known?.message ??
          (validation ? "Request validation failed" : "Internal server error"),
        ...(validation ? { details: validation.issues } : {})
      }
    });
  });

  app.get("/api/health", async () => ({ ok: true, service: "pi-web-server" }));
  app.post<{ Body: { key?: string } }>("/api/auth/login", async (request, reply) => {
    if (typeof request.body?.key !== "string") {
      return reply.code(400).send({ error: { code: "KEY_REQUIRED", message: "Access key is required" } });
    }
    try {
      const result = await auth.login(request.body.key, request.ip);
      auth.setCookie(
        reply,
        result.token,
        shouldUseSecureCookie(config, request.protocol)
      );
      return { authenticated: true };
    } catch {
      return reply
        .code(401)
        .send({ error: { code: "INVALID_ACCESS_KEY", message: "Access key is incorrect" } });
    }
  });
  app.post("/api/auth/logout", async (request, reply) => {
    await auth.logout(request.cookies.pi_web_session);
    auth.clearCookie(reply);
    return { authenticated: false };
  });
  app.get("/api/auth/session", async () => ({ authenticated: true }));
  app.post("/api/auth/reset-key", async (request, reply) => {
    const key = await auth.reset();
    auth.clearCookie(reply);
    return { key, note: "This key is shown once. Existing browser sessions are now signed out." };
  });

  app.get("/api/system", async (request) => ({
    version: "0.1.0",
    secureConnection: request.protocol === "https",
    warning:
      request.protocol === "https"
        ? null
        : "当前连接未加密。不要通过不可信公网直接传输访问密钥或控制 Pi。"
  }));
  app.get("/api/dashboard", async () => await client.request("dashboard"));

  app.get("/api/sessions", async () => await client.request("sessions.list"));
  app.post<{ Body: unknown }>("/api/sessions", async (request, reply) => {
    const input = createSessionSchema.parse(request.body);
    const session = await client.request<{ id: string }>("sessions.create", input);
    return reply.code(201).send(session);
  });
  app.patch<{ Params: { id: string }; Body: unknown }>(
    "/api/sessions/:id",
    async (request) => {
      const input = sessionRenameSchema.parse(request.body);
      return await client.request("sessions.rename", {
        id: idSchema.parse(request.params.id),
        ...input
      });
    }
  );
  app.get<{ Params: { id: string }; Querystring: { cursor?: string } }>(
    "/api/sessions/:id",
    async (request) =>
      await client.request("sessions.snapshot", {
        id: idSchema.parse(request.params.id),
        cursor: request.query.cursor
      })
  );
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/api/sessions/:id/resume",
    async (request) => {
      const input = resumeSessionSchema.parse(request.body ?? {});
      return await client.request("sessions.resume", {
        id: idSchema.parse(request.params.id),
        ...input
      });
    }
  );
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/api/sessions/:id/messages",
    async (request, reply) => {
      const input = promptSchema.parse(request.body);
      await client.request("sessions.prompt", {
        id: idSchema.parse(request.params.id),
        ...input
      });
      return reply.code(202).send({ accepted: true });
    }
  );
  app.post<{ Params: { id: string } }>("/api/sessions/:id/abort", async (request) => {
    return await client.request("sessions.abort", {
      id: idSchema.parse(request.params.id)
    });
  });
  app.post<{ Params: { id: string } }>("/api/sessions/:id/close", async (request) => {
    return await client.request("sessions.close", {
      id: idSchema.parse(request.params.id)
    });
  });
  app.put<{ Params: { id: string }; Body: { model?: string } }>(
    "/api/sessions/:id/model",
    async (request) =>
      await client.request("sessions.model", {
        id: idSchema.parse(request.params.id),
        model: z.string().min(3).max(300).parse(request.body?.model)
      })
  );
  app.put<{ Params: { id: string }; Body: { thinkingLevel?: string } }>(
    "/api/sessions/:id/thinking",
    async (request) =>
      await client.request("sessions.thinking", {
        id: idSchema.parse(request.params.id),
        thinkingLevel: z.enum(thinkingLevels).parse(request.body?.thinkingLevel)
      })
  );

  app.get("/api/session-folders", async () => await sessionFolders.get());
  app.post<{ Body: unknown }>("/api/session-folders", async (request, reply) =>
    reply.code(201).send(await sessionFolders.create(request.body))
  );
  app.put<{ Params: { id: string }; Body: unknown }>(
    "/api/session-folders/:id",
    async (request) =>
      await sessionFolders.rename(
        idSchema.parse(request.params.id),
        request.body
      )
  );
  app.delete<{ Params: { id: string } }>(
    "/api/session-folders/:id",
    async (request) =>
      await sessionFolders.remove(idSchema.parse(request.params.id))
  );
  app.put<{ Params: { sessionId: string }; Body: unknown }>(
    "/api/session-folders/assign/:sessionId",
    async (request) =>
      await sessionFolders.assign(
        idSchema.parse(request.params.sessionId),
        request.body
      )
  );

  app.get("/api/directories", async () => await client.request("directories.list"));
  app.put<{ Body: { path?: string; favorite?: boolean; alias?: string | null } }>(
    "/api/directories/favorite",
    async (request) =>
      await client.request("directories.favorite", {
        path: z.string().min(1).parse(request.body?.path),
        favorite: Boolean(request.body?.favorite),
        alias: request.body?.alias
      })
  );
  app.get<{ Querystring: { root?: string; path?: string } }>(
    "/api/directories/browse",
    async (request) =>
      await client.request("directories.browse", {
        root: z.string().min(1).parse(request.query.root),
        path: request.query.path ?? ""
      })
  );

  app.get("/api/schedules", async () => await client.request("schedules.list"));
  app.get("/api/schedule-runs", async () =>
    await client.request("schedules.runs")
  );
  app.post<{ Body: unknown }>("/api/schedules", async (request, reply) => {
    const input = jobInputSchema.parse(request.body);
    return reply
      .code(201)
      .send(await client.request("schedules.create", input));
  });
  app.get<{ Params: { id: string } }>("/api/schedules/:id", async (request) =>
    await client.request("schedules.get", { id: idSchema.parse(request.params.id) })
  );
  app.put<{ Params: { id: string }; Body: unknown }>(
    "/api/schedules/:id",
    async (request) =>
      await client.request("schedules.update", {
        id: idSchema.parse(request.params.id),
        ...jobInputSchema.parse(request.body)
      })
  );
  app.post<{ Params: { id: string }; Body: { enabled?: boolean } }>(
    "/api/schedules/:id/enabled",
    async (request) =>
      await client.request("schedules.enable", {
        id: idSchema.parse(request.params.id),
        enabled: Boolean(request.body?.enabled)
      })
  );
  app.delete<{ Params: { id: string } }>("/api/schedules/:id", async (request) =>
    await client.request("schedules.delete", { id: idSchema.parse(request.params.id) })
  );
  app.post<{ Params: { id: string } }>("/api/schedules/:id/run", async (request) =>
    await client.request("schedules.run_now", { id: idSchema.parse(request.params.id) })
  );
  app.get<{ Params: { id: string } }>("/api/schedules/:id/runs", async (request) =>
    await client.request("schedules.runs", { jobId: idSchema.parse(request.params.id) })
  );

  app.get("/api/pi", async () => await client.request("pi.status", undefined, 30_000));
  app.post<{ Body: { action?: string; source?: string } }>(
    "/api/pi/packages",
    async (request) =>
      await client.request(
        "pi.package",
        {
          action: z
            .enum(["install", "remove", "update_all"])
            .parse(request.body?.action),
          source: request.body?.source
        },
        6 * 60_000
      )
  );

  app.get("/api/settings", async () => await client.request("settings.get"));
  app.put<{ Body: unknown }>("/api/settings", async (request) => {
    const input = settingsUpdateSchema.parse(request.body);
    const updated = await client.request<PiWebConfig>("settings.update", input);
    config = updated;
    auth.updateConfig(updated);
    return updated;
  });
  app.get("/api/doctor", async () => await client.request("doctor", undefined, 30_000));

  registerThemeRoutes(app, options.paths);
  registerFileRoutes(app, client, () => config);
  registerTerminalRoutes(app, client, () => config);
  registerWebSocket(app, client);

  const webRoot = process.env.PI_WEB_WEB_ROOT
    ? resolve(process.env.PI_WEB_WEB_ROOT)
    : fileURLToPath(new URL("../../web/dist/", import.meta.url));
  const hasWeb = await access(webRoot).then(() => true).catch(() => false);
  if (hasWeb) {
    await app.register(fastifyStatic, {
      root: webRoot,
      prefix: "/",
      wildcard: false,
      maxAge: "1h",
      immutable: false
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        return reply.code(404).send({ error: { code: "NOT_FOUND", message: "API route not found" } });
      }
      return reply.sendFile("index.html", { maxAge: 0, immutable: false });
    });
  } else {
    app.get("/", async () => ({
      name: "Pi Web",
      message: "Web assets are not built. Run pnpm --filter @pi-web/web build."
    }));
  }
  return app;
}

function originMatches(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

interface BrowserSocket {
  readonly readyState: number;
  readonly OPEN: number;
  send(value: string): void;
  on(event: "message", listener: (value: unknown) => void): void;
  on(event: "close" | "error", listener: () => void): void;
}

type SessionSyncResult =
  | {
      mode: "incremental";
      events: RealtimeEvent[];
      sequence: number;
    }
  | {
      mode: "snapshot";
      snapshot: SessionSnapshot;
    };

function registerWebSocket(app: FastifyInstance, client: SessiondClient): void {
  const subscribers = new Map<BrowserSocket, Map<string, number>>();
  client.on("event", (event: RealtimeEvent) => {
    const message = JSON.stringify({ type: "event", event });
    for (const [socket, sessions] of subscribers) {
      const afterSequence = sessions.get(event.sessionId);
      if (
        afterSequence !== undefined &&
        event.sequence > afterSequence &&
        socket.readyState === socket.OPEN
      ) {
        sessions.set(event.sessionId, event.sequence);
        socket.send(message);
      }
    }
  });
  client.on("connect", () => {
    for (const [socket, sessions] of subscribers) {
      for (const [sessionId, afterSequence] of sessions) {
        void syncBrowserSubscription(
          socket,
          client,
          sessionId,
          afterSequence,
          true
        )
          .then((sequence) => {
            if (sessions.has(sessionId)) {
              sessions.set(
                sessionId,
                Math.max(sessions.get(sessionId) ?? 0, sequence)
              );
            }
          })
          .catch((error) => sendBrowserSocketError(socket, error));
      }
    }
  });

  app.get(
    "/api/ws",
    { websocket: true },
    (rawSocket) => {
      const socket = rawSocket as unknown as BrowserSocket;
      subscribers.set(socket, new Map());
      socket.on("message", (raw: unknown) => {
        void (async () => {
          try {
            const input = browserSocketMessageSchema.parse(
              JSON.parse(String(raw))
            );
            if (input.type === "ping") {
              socket.send(JSON.stringify({ type: "pong", at: Date.now() }));
              return;
            }
            const set = subscribers.get(socket);
            if (!set) return;
            if (input.type === "unsubscribe") {
              set.delete(input.sessionId);
              return;
            }
            set.set(input.sessionId, input.afterSequence);
            const sequence = await syncBrowserSubscription(
              socket,
              client,
              input.sessionId,
              input.afterSequence
            );
            if (set.has(input.sessionId)) {
              set.set(
                input.sessionId,
                Math.max(set.get(input.sessionId) ?? 0, sequence)
              );
            }
          } catch (error) {
            sendBrowserSocketError(socket, error);
          }
        })();
      });
      socket.on("close", () => subscribers.delete(socket));
      socket.on("error", () => subscribers.delete(socket));
    }
  );
}

export async function syncBrowserSubscription(
  socket: Pick<BrowserSocket, "readyState" | "OPEN" | "send">,
  client: Pick<SessiondClient, "request">,
  sessionId: string,
  afterSequence: number,
  forceSnapshot = false
): Promise<number> {
  const sync = forceSnapshot
    ? {
        mode: "snapshot" as const,
        snapshot: await client.request<SessionSnapshot>("sessions.snapshot", {
          id: sessionId
        })
      }
    : await client.request<SessionSyncResult>("sessions.sync", {
        id: sessionId,
        afterSequence
      });
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify({ type: "sync", sessionId, ...sync }));
  }
  return sync.mode === "snapshot"
    ? sync.snapshot.sequence
    : sync.sequence;
}

function sendBrowserSocketError(
  socket: Pick<BrowserSocket, "readyState" | "OPEN" | "send">,
  error: unknown
): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(
      JSON.stringify({
        type: "error",
        message: safeErrorMessage(error)
      })
    );
  }
}
