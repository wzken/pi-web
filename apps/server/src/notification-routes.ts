import type { FastifyInstance } from "fastify";
import type { PiWebConfig } from "@pi-web/config";
import { z } from "zod";
import type { PushService, PushSubscriptionInput } from "./push-service.js";
import { remoteAccessInfo } from "./remote-access.js";
import type { SessiondClient } from "@pi-web/ipc";

const idSchema = z.string().uuid();
const pushSubscriptionSchema = z
  .object({
    endpoint: z.string().url().max(4_096),
    expirationTime: z.number().nullable().optional(),
    keys: z
      .object({
        p256dh: z.string().min(1).max(1_024),
        auth: z.string().min(1).max(1_024)
      })
      .strict()
  })
  .strict();

export function registerNotificationRoutes(
  app: FastifyInstance,
  client: SessiondClient,
  push: PushService,
  getConfig: () => PiWebConfig
): void {
  app.get<{ Querystring: { limit?: string } }>(
    "/api/notifications",
    async (request) =>
      await client.request("notifications.list", {
        limit: boundedLimit(request.query.limit)
      })
  );
  app.post<{ Params: { id: string } }>(
    "/api/notifications/:id/read",
    async (request) =>
      await client.request("notifications.read", {
        id: idSchema.parse(request.params.id)
      })
  );
  app.post("/api/notifications/read-all", async () =>
    await client.request("notifications.read_all")
  );
  app.post<{ Params: { id: string } }>(
    "/api/notifications/:id/dismiss",
    async (request) =>
      await client.request("notifications.dismiss", {
        id: idSchema.parse(request.params.id)
      })
  );
  app.post<{ Params: { sessionId: string } }>(
    "/api/notifications/session/:sessionId/read",
    async (request) =>
      await client.request("notifications.read_session", {
        sessionId: idSchema.parse(request.params.sessionId)
      })
  );

  app.get("/api/push/config", async () => ({
    supported: true,
    publicKey: push.publicKey
  }));
  app.post<{ Body: unknown }>("/api/push/subscriptions", async (request, reply) => {
    const subscription = pushSubscriptionSchema.parse(request.body);
    const stored = await push.subscribe(
      subscription satisfies PushSubscriptionInput,
      request.headers["user-agent"] ?? null
    );
    return reply.code(201).send({ subscribed: true, id: stored.id });
  });
  app.delete<{ Body: { endpoint?: string } }>(
    "/api/push/subscriptions",
    async (request) => ({
      unsubscribed: (
        await push.unsubscribe(
          z.string().url().max(4_096).parse(request.body?.endpoint)
        )
      ).deleted
    })
  );
  app.post<{ Body: unknown }>("/api/push/test", async (request) => {
    const subscription = pushSubscriptionSchema.parse(request.body);
    await push.sendTest(subscription);
    return { sent: true };
  });

  app.get("/api/remote-access", async (request) =>
    await remoteAccessInfo(request, getConfig())
  );
}

function boundedLimit(value: string | undefined): number {
  const parsed = Number(value ?? 100);
  return Number.isFinite(parsed)
    ? Math.max(1, Math.min(500, Math.floor(parsed)))
    : 100;
}
