import type { FastifyInstance } from "fastify";
import type { PiWebConfig } from "@pi-web/config";
import {
  jobInputSchema,
  settingsUpdateSchema
} from "@pi-web/protocol";
import { z } from "zod";
import type { AuthManager } from "./auth.js";
import type { SessiondClient } from "./sessiond-client.js";

const idSchema = z.string().uuid();

export function registerControlRoutes(
  app: FastifyInstance,
  client: SessiondClient,
  auth: AuthManager,
  updateConfig: (config: PiWebConfig) => void
): void {
  app.get("/api/health", async () => ({
    ok: true,
    service: "pi-web-server"
  }));
  app.get("/api/system", async (request) => ({
    version: "0.1.0",
    secureConnection: request.protocol === "https",
    warning:
      request.protocol === "https"
        ? null
        : "当前连接未加密。不要通过不可信公网直接传输访问密钥或控制 Pi。"
  }));
  app.get("/api/dashboard", async () => await client.request("dashboard"));

  app.get("/api/directories", async () =>
    await client.request("directories.list")
  );
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

  app.get("/api/schedules", async () =>
    await client.request("schedules.list")
  );
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
    await client.request("schedules.get", {
      id: idSchema.parse(request.params.id)
    })
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
    await client.request("schedules.delete", {
      id: idSchema.parse(request.params.id)
    })
  );
  app.post<{ Params: { id: string } }>(
    "/api/schedules/:id/run",
    async (request) =>
      await client.request("schedules.run_now", {
        id: idSchema.parse(request.params.id)
      })
  );
  app.get<{ Params: { id: string } }>(
    "/api/schedules/:id/runs",
    async (request) =>
      await client.request("schedules.runs", {
        jobId: idSchema.parse(request.params.id)
      })
  );

  app.get("/api/pi", async () =>
    await client.request("pi.status", undefined, 30_000)
  );
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

  app.get("/api/settings", async () =>
    await client.request("settings.get")
  );
  app.put<{ Body: unknown }>("/api/settings", async (request) => {
    const input = settingsUpdateSchema.parse(request.body);
    const updated = await client.request<PiWebConfig>(
      "settings.update",
      input
    );
    updateConfig(updated);
    auth.updateConfig(updated);
    return updated;
  });
  app.get("/api/doctor", async () =>
    await client.request("doctor", undefined, 30_000)
  );
}
