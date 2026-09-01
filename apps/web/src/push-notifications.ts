import { api, jsonBody } from "./api";

export interface PushState {
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  subscribed: boolean;
}

interface PushConfig {
  supported: boolean;
  publicKey: string;
}

export function pushAvailable(): boolean {
  return (
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    typeof Notification !== "undefined"
  );
}

export async function readPushState(): Promise<PushState> {
  if (!pushAvailable()) return unsupportedPushState();
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = registration
    ? await registration.pushManager.getSubscription()
    : null;
  if (subscription && Notification.permission === "granted") {
    await api("/api/push/subscriptions", {
      method: "POST",
      ...jsonBody(subscription.toJSON())
    });
  }
  return {
    supported: true,
    permission: Notification.permission,
    subscribed: subscription !== null
  };
}

export async function enablePushNotifications(): Promise<PushState> {
  if (!pushAvailable()) return unsupportedPushState();
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { supported: true, permission, subscribed: false };
  }
  const [registration, config] = await Promise.all([
    serviceWorkerRegistration(),
    api<PushConfig>("/api/push/config")
  ]);
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.publicKey)
    });
  }
  await api("/api/push/subscriptions", {
    method: "POST",
    ...jsonBody(subscription.toJSON())
  });
  return { supported: true, permission, subscribed: true };
}

export async function disablePushNotifications(): Promise<PushState> {
  if (!pushAvailable()) return unsupportedPushState();
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = registration
    ? await registration.pushManager.getSubscription()
    : null;
  if (subscription) {
    await api("/api/push/subscriptions", {
      method: "DELETE",
      ...jsonBody({ endpoint: subscription.endpoint })
    }).catch(() => undefined);
    await subscription.unsubscribe();
  }
  return {
    supported: true,
    permission: Notification.permission,
    subscribed: false
  };
}

export async function sendTestPush(): Promise<void> {
  if (!pushAvailable()) throw new Error("Push notifications are unavailable");
  const registration = await serviceWorkerRegistration();
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) throw new Error("Push notifications are not subscribed");
  await api("/api/push/test", {
    method: "POST",
    ...jsonBody(subscription.toJSON())
  });
}

async function serviceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  return await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_resolve, reject) => {
      window.setTimeout(
        () => reject(new Error("Pi Web service worker is not ready")),
        5_000
      );
    })
  ]);
}

function unsupportedPushState(): PushState {
  return { supported: false, permission: "unsupported", subscribed: false };
}

export function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return bytes;
}
