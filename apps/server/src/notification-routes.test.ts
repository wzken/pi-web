import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PiWebConfig } from "@pi-web/config";
import { registerGatewayErrorHandler } from "./gateway.js";
import { registerNotificationRoutes } from "./notification-routes.js";
import type { PushService } from "./push-service.js";
import type { SessiondClient } from "@pi-web/ipc";

const config = {
  host: "127.0.0.1",
  port: 8787,
  cookieSecure: "auto",
  trustedProxy: false
} as PiWebConfig;

describe("notification HTTP routes", () => {
  const apps: Array<ReturnType<typeof Fastify>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map(async (app) => await app.close()));
  });

  it("maps inbox mutations and push subscriptions to the session daemon", async () => {
    const app = Fastify();
    apps.push(app);
    registerGatewayErrorHandler(app);
    const request = vi.fn(async (method: string) => {
      if (method === "notifications.list" || method === "notifications.read_all") {
        return { notifications: [], unreadCount: 0, attentionCount: 0 };
      }
      if (method === "notifications.read" || method === "notifications.dismiss") {
        return { id: "00000000-0000-4000-8000-000000000001" };
      }
      return { notifications: [], unreadCount: 0, attentionCount: 0 };
    });
    const push = {
      publicKey: "public-key",
      subscribe: vi.fn(async () => ({ id: "subscription-1" })),
      unsubscribe: vi.fn(async () => ({ deleted: true })),
      sendTest: vi.fn(async () => undefined)
    } as unknown as PushService;
    registerNotificationRoutes(
      app,
      { request } as unknown as SessiondClient,
      push,
      () => config
    );

    expect((await app.inject({ url: "/api/notifications?limit=999" })).statusCode).toBe(200);
    expect(request).toHaveBeenCalledWith("notifications.list", { limit: 500 });

    const id = "00000000-0000-4000-8000-000000000001";
    await app.inject({ method: "POST", url: `/api/notifications/${id}/read` });
    expect(request).toHaveBeenCalledWith("notifications.read", { id });
    await app.inject({ method: "POST", url: "/api/notifications/read-all" });
    expect(request).toHaveBeenCalledWith("notifications.read_all");
    await app.inject({ method: "POST", url: `/api/notifications/${id}/dismiss` });
    expect(request).toHaveBeenCalledWith("notifications.dismiss", { id });
    await app.inject({
      method: "POST",
      url: `/api/notifications/session/${id}/read`
    });
    expect(request).toHaveBeenCalledWith("notifications.read_session", {
      sessionId: id
    });

    const subscription = {
      endpoint: "https://push.example/subscription",
      expirationTime: null,
      keys: { p256dh: "p256dh", auth: "auth" }
    };
    const subscribed = await app.inject({
      method: "POST",
      url: "/api/push/subscriptions",
      headers: { "user-agent": "test-browser" },
      payload: subscription
    });
    expect(subscribed.statusCode).toBe(201);
    expect(push.subscribe).toHaveBeenCalledWith(subscription, "test-browser");
    await app.inject({
      method: "POST",
      url: "/api/push/test",
      payload: subscription
    });
    expect(push.sendTest).toHaveBeenCalledWith(subscription);
    await app.inject({
      method: "DELETE",
      url: "/api/push/subscriptions",
      payload: { endpoint: subscription.endpoint }
    });
    expect(push.unsubscribe).toHaveBeenCalledWith(subscription.endpoint);
  });

  it("rejects malformed push subscription material", async () => {
    const app = Fastify();
    apps.push(app);
    registerGatewayErrorHandler(app);
    const push = {
      publicKey: "public-key",
      subscribe: vi.fn()
    } as unknown as PushService;
    registerNotificationRoutes(
      app,
      { request: vi.fn() } as unknown as SessiondClient,
      push,
      () => config
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/push/subscriptions",
      payload: {
        endpoint: "not-a-url",
        keys: { p256dh: "", auth: "" }
      }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" }
    });
    expect(push.subscribe).not.toHaveBeenCalled();
  });
});
