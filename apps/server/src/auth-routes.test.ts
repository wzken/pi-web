import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PiWebConfig } from "@pi-web/config";
import { PiWebError } from "@pi-web/shared";
import { registerAuthRoutes } from "./auth-routes.js";
import type { AuthManager } from "./auth.js";
import { registerGatewayErrorHandler } from "./gateway.js";

describe("authentication HTTP routes", () => {
  const apps: Array<ReturnType<typeof Fastify>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map(async (app) => await app.close()));
  });

  it("does not report a persistence outage as an invalid access key", async () => {
    const app = Fastify();
    apps.push(app);
    registerGatewayErrorHandler(app);
    const auth = {
      login: vi.fn().mockRejectedValue(
        new PiWebError(
          "SESSIOND_UNAVAILABLE",
          "Session daemon is unavailable",
          503
        )
      )
    } as unknown as AuthManager;
    registerAuthRoutes(app, auth, () => ({ cookieSecure: "auto" }) as PiWebConfig);

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { key: "correct-access-key" }
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: {
        code: "SESSIOND_UNAVAILABLE",
        message: "Session daemon is unavailable"
      }
    });
  });
});
