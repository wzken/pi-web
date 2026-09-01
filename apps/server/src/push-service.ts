import type {
  NotificationRecord,
  PushDeliveryTarget,
  PushSubscriptionRecord,
  PushVapidKeys
} from "@pi-web/protocol";
import { safeErrorMessage } from "@pi-web/shared";
import webpush from "web-push";
import type { SessiondClient } from "@pi-web/ipc";

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushTransport {
  generateVAPIDKeys(): PushVapidKeys;
  setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  sendNotification(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
    options: { TTL: number; urgency: "normal" | "high" }
  ): Promise<unknown>;
}

export class PushService {
  readonly #client: SessiondClient;
  readonly #transport: PushTransport;
  #keys: PushVapidKeys | null = null;
  #draining: Promise<void> | null = null;
  #deliveryTimer: NodeJS.Timeout | null = null;
  #stopped = false;
  readonly #onNotification = () => {
    if (this.#deliveryTimer) return;
    this.#deliveryTimer = setTimeout(() => {
      this.#deliveryTimer = null;
      void this.drain().catch(() => undefined);
    }, 750);
    this.#deliveryTimer.unref();
  };
  readonly #onConnect = () => void this.drain().catch(() => undefined);

  constructor(
    client: SessiondClient,
    transport: PushTransport = webpush
  ) {
    this.#client = client;
    this.#transport = transport;
  }

  async start(): Promise<void> {
    let keys = await this.#client.request("push.vapid.get");
    if (!keys) {
      const generated = this.#transport.generateVAPIDKeys();
      keys = await this.#client.request("push.vapid.set", generated);
    }
    if (!keys) throw new Error("Push VAPID keys are unavailable");
    this.#keys = keys;
    this.#transport.setVapidDetails(
      "https://pi-web.local",
      keys.publicKey,
      keys.privateKey
    );
    this.#client.on("notification", this.#onNotification);
    this.#client.on("connect", this.#onConnect);
    await this.drain();
  }

  stop(): void {
    this.#stopped = true;
    if (this.#deliveryTimer) {
      clearTimeout(this.#deliveryTimer);
      this.#deliveryTimer = null;
    }
    this.#client.off("notification", this.#onNotification);
    this.#client.off("connect", this.#onConnect);
  }

  get publicKey(): string {
    if (!this.#keys) throw new Error("Push service is not initialized");
    return this.#keys.publicKey;
  }

  async subscribe(
    input: PushSubscriptionInput,
    userAgent?: string | null
  ): Promise<PushSubscriptionRecord> {
    return await this.#client.request("push.subscription.upsert", {
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent: userAgent ?? null
    });
  }

  async unsubscribe(endpoint: string): Promise<{ deleted: boolean }> {
    return await this.#client.request("push.subscription.delete", { endpoint });
  }

  async sendTest(subscription: PushSubscriptionInput): Promise<void> {
    await this.#transport.sendNotification(
      toWebPushSubscription(subscription),
      JSON.stringify({
        title: "Pi Web notifications are ready",
        body: "This device can receive background supervision alerts.",
        tag: "pi-web-push-test",
        data: { href: "/notifications" },
        icon: "/pwa-192.png",
        badge: "/pwa-192.png"
      }),
      { TTL: 60, urgency: "normal" }
    );
  }

  drain(): Promise<void> {
    if (this.#stopped) return Promise.resolve();
    this.#draining ??= this.#drain().finally(() => {
      this.#draining = null;
    });
    return this.#draining;
  }

  async #drain(): Promise<void> {
    while (!this.#stopped) {
      const targets = await this.#client.request(
        "push.deliveries.pending",
        { limit: 100 }
      );
      if (targets.length === 0) return;
      for (const target of targets) {
        if (this.#stopped) return;
        await this.#deliver(target);
      }
    }
  }

  async #deliver(target: PushDeliveryTarget): Promise<void> {
    try {
      await this.#transport.sendNotification(
        toWebPushSubscription(target.subscription),
        JSON.stringify(pushPayload(target.notification)),
        {
          TTL: target.notification.requiresAction ? 24 * 60 * 60 : 60 * 60,
          urgency: target.notification.requiresAction ? "high" : "normal"
        }
      );
      await this.#client.request("push.delivery.record", {
        notificationId: target.notification.id,
        subscriptionId: target.subscription.id,
        delivered: true
      });
    } catch (error) {
      const statusCode = pushStatusCode(error);
      if (statusCode === 404 || statusCode === 410) {
        await this.unsubscribe(target.subscription.endpoint).catch(() => undefined);
        return;
      }
      await this.#client.request("push.delivery.record", {
        notificationId: target.notification.id,
        subscriptionId: target.subscription.id,
        delivered: false,
        errorSummary: safeErrorMessage(error)
      });
    }
  }
}

function pushPayload(notification: NotificationRecord) {
  return {
    title: notification.title,
    body: notification.body,
    tag: `pi-web-${notification.kind}-${notification.id}`,
    renotify: notification.requiresAction,
    requireInteraction: notification.requiresAction,
    data: {
      href: notification.href,
      notificationId: notification.id
    },
    icon: "/pwa-192.png",
    badge: "/pwa-192.png"
  };
}

function toWebPushSubscription(input: PushSubscriptionInput | PushSubscriptionRecord) {
  return {
    endpoint: input.endpoint,
    keys:
      "keys" in input
        ? input.keys
        : { p256dh: input.p256dh, auth: input.auth }
  };
}

function pushStatusCode(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const value = (error as { statusCode?: unknown }).statusCode;
  return typeof value === "number" ? value : null;
}
