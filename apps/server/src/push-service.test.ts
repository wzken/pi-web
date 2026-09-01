import { EventEmitter } from "node:events";
import type {
  NotificationRecord,
  PushDeliveryTarget,
  PushVapidKeys
} from "@pi-web/protocol";
import { describe, expect, it, vi } from "vitest";
import {
  PushService,
  type PushTransport
} from "./push-service.js";
import type { SessiondClient } from "@pi-web/ipc";

const keys: PushVapidKeys = {
  publicKey: "public-vapid-key",
  privateKey: "private-vapid-key"
};

function target(id: string): PushDeliveryTarget {
  const notification: NotificationRecord = {
    id: `notification-${id}`,
    kind: "extension_interaction",
    severity: "warning",
    title: "Pi needs your decision",
    body: "Private session name",
    href: `/sessions/session-${id}`,
    sessionId: `session-${id}`,
    jobId: null,
    runId: null,
    requiresAction: true,
    readAt: null,
    resolvedAt: null,
    dismissedAt: null,
    createdAt: "2026-08-12T05:00:00.000Z",
    updatedAt: "2026-08-12T05:00:00.000Z"
  };
  return {
    notification,
    subscription: {
      id: `subscription-${id}`,
      endpoint: `https://push.example/${id}`,
      p256dh: `p256dh-${id}`,
      auth: `auth-${id}`,
      userAgent: "test",
      createdAt: notification.createdAt,
      updatedAt: notification.updatedAt
    }
  };
}

class FakeClient extends EventEmitter {
  readonly requests: Array<{ method: string; params: unknown }> = [];
  readonly attempts = new Map<string, number>();
  targets: PushDeliveryTarget[] = [];

  async request<T>(method: string, params?: unknown): Promise<T> {
    this.requests.push({ method, params });
    if (method === "push.vapid.get") return keys as T;
    if (method === "push.deliveries.pending") {
      const pending = this.targets.filter(
        (item) => (this.attempts.get(item.subscription.id) ?? 0) < 3
      );
      return pending as T;
    }
    if (method === "push.delivery.record") {
      const input = params as {
        subscriptionId: string;
        delivered: boolean;
      };
      if (input.delivered) {
        this.targets = this.targets.filter(
          (item) => item.subscription.id !== input.subscriptionId
        );
      } else {
        this.attempts.set(
          input.subscriptionId,
          (this.attempts.get(input.subscriptionId) ?? 0) + 1
        );
      }
      return { recorded: true } as T;
    }
    if (method === "push.subscription.delete") {
      const endpoint = (params as { endpoint: string }).endpoint;
      this.targets = this.targets.filter(
        (item) => item.subscription.endpoint !== endpoint
      );
      return { deleted: true } as T;
    }
    throw new Error(`Unexpected method: ${method}`);
  }
}

function transport(
  sendNotification: PushTransport["sendNotification"]
): PushTransport {
  return {
    generateVAPIDKeys: vi.fn(() => keys),
    setVapidDetails: vi.fn(),
    sendNotification
  };
}

describe("PushService", () => {
  it("delivers a privacy-bounded payload and records success", async () => {
    const client = new FakeClient();
    client.targets = [target("one")];
    const sendNotification = vi.fn<PushTransport["sendNotification"]>(
      async () => undefined
    );
    const push = new PushService(
      client as unknown as SessiondClient,
      transport(sendNotification)
    );

    await push.start();

    expect(sendNotification).toHaveBeenCalledOnce();
    const payload = JSON.parse(sendNotification.mock.calls[0]![1]) as {
      title: string;
      body: string;
      data: { href: string; notificationId: string };
    };
    expect(payload).toEqual(
      expect.objectContaining({
        title: "Pi needs your decision",
        body: "Private session name",
        data: {
          href: "/sessions/session-one",
          notificationId: "notification-one"
        }
      })
    );
    expect(JSON.stringify(payload)).not.toContain("prompt");
    expect(client.requests).toContainEqual({
      method: "push.delivery.record",
      params: {
        notificationId: "notification-one",
        subscriptionId: "subscription-one",
        delivered: true
      }
    });
    push.stop();
  });

  it("retries transient failures three times and then stops", async () => {
    const client = new FakeClient();
    client.targets = [target("retry")];
    const sendNotification = vi.fn<PushTransport["sendNotification"]>(
      async () => {
        throw new Error("temporary push outage");
      }
    );
    const push = new PushService(
      client as unknown as SessiondClient,
      transport(sendNotification)
    );

    await push.start();

    expect(sendNotification).toHaveBeenCalledTimes(3);
    expect(client.attempts.get("subscription-retry")).toBe(3);
    expect(
      client.requests.filter((request) => request.method === "push.delivery.record")
    ).toHaveLength(3);
    push.stop();
  });

  it("removes a permanently expired subscription without retrying", async () => {
    const client = new FakeClient();
    client.targets = [target("expired")];
    const sendNotification = vi.fn<PushTransport["sendNotification"]>(
      async () => {
        throw Object.assign(new Error("gone"), { statusCode: 410 });
      }
    );
    const push = new PushService(
      client as unknown as SessiondClient,
      transport(sendNotification)
    );

    await push.start();

    expect(sendNotification).toHaveBeenCalledOnce();
    expect(client.requests).toContainEqual({
      method: "push.subscription.delete",
      params: { endpoint: "https://push.example/expired" }
    });
    expect(
      client.requests.some((request) => request.method === "push.delivery.record")
    ).toBe(false);
    push.stop();
  });
});
