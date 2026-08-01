import type { FastifyInstance } from "fastify";
import type { PiWebConfig } from "@pi-web/config";
import { AuthManager, shouldUseSecureCookie } from "./auth.js";

export function registerAuthRoutes(
  app: FastifyInstance,
  auth: AuthManager,
  getConfig: () => PiWebConfig
): void {
  app.post<{ Body: { key?: string } }>(
    "/api/auth/login",
    async (request, reply) => {
      if (typeof request.body?.key !== "string") {
        return reply.code(400).send({
          error: { code: "KEY_REQUIRED", message: "Access key is required" }
        });
      }
      const result = await auth.login(request.body.key, request.ip);
      auth.setCookie(
        reply,
        result.token,
        shouldUseSecureCookie(getConfig(), request.protocol)
      );
      return { authenticated: true };
    }
  );
  app.post("/api/auth/logout", async (request, reply) => {
    await auth.logout(request.cookies.pi_web_session);
    auth.clearCookie(reply);
    return { authenticated: false };
  });
  app.get("/api/auth/session", async () => ({ authenticated: true }));
  app.post("/api/auth/reset-key", async (_request, reply) => {
    const key = await auth.reset();
    auth.clearCookie(reply);
    return {
      key,
      note: "This key is shown once. Existing browser sessions are now signed out."
    };
  });
}
