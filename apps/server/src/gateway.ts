import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import type {
  FastifyInstance,
  FastifyRequest
} from "fastify";
import { PiWebError } from "@pi-web/shared";
import { z } from "zod";
import type { AuthManager } from "./auth.js";

export function registerGatewaySecurity(
  app: FastifyInstance,
  auth: Pick<AuthManager, "validate">
): void {
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
      return reply.code(401).send({
        error: { code: "UNAUTHORIZED", message: "Sign in required" }
      });
    }
  });

  app.addHook("preValidation", async (request, reply) => {
    const path = request.url.split("?")[0] ?? request.url;
    if (!path.startsWith("/api/")) return;
    const writes = !["GET", "HEAD", "OPTIONS"].includes(request.method);
    const isWebSocket = path === "/api/ws" || path === "/api/terminal";
    if ((writes || isWebSocket) && !originMatches(request)) {
      return reply.code(403).send({
        error: {
          code: "ORIGIN_REJECTED",
          message: "Request Origin does not match this Pi Web host"
        }
      });
    }
  });
}

export function registerGatewayErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const known = error instanceof PiWebError ? error : null;
    const validation = error instanceof z.ZodError ? error : null;
    const statusCode = known?.statusCode ?? (validation ? 400 : 500);
    if (statusCode >= 500) request.log.error({ err: error }, "request failed");
    void reply.code(statusCode).send({
      error: {
        code:
          known?.code ??
          (validation ? "VALIDATION_ERROR" : "INTERNAL_ERROR"),
        message:
          known?.message ??
          (validation
            ? "Request validation failed"
            : "Internal server error"),
        ...(validation ? { details: validation.issues } : {})
      }
    });
  });
}

export async function registerWebAssets(app: FastifyInstance): Promise<void> {
  const webRoot = process.env.PI_WEB_WEB_ROOT
    ? resolve(process.env.PI_WEB_WEB_ROOT)
    : fileURLToPath(new URL("../../web/dist/", import.meta.url));
  const hasWeb = await access(webRoot)
    .then(() => true)
    .catch(() => false);
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
        return reply.code(404).send({
          error: { code: "NOT_FOUND", message: "API route not found" }
        });
      }
      return reply.sendFile("index.html", { maxAge: 0, immutable: false });
    });
  } else {
    app.get("/", async () => ({
      name: "Pi Web",
      message: "Web assets are not built. Run pnpm --filter @pi-web/web build."
    }));
  }
}

function originMatches(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (!origin || !host) return false;
  try {
    return (
      new URL(origin).origin ===
      new URL(`${request.protocol}://${host}`).origin
    );
  } catch {
    return false;
  }
}
