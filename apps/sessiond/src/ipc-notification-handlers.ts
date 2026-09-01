import type { IpcHandlerMap } from "./ipc-handler.js";
import { asRecord, numberParam, optionalString, stringParam } from "./ipc-params.js";
import { NotificationCenter } from "./notification-center.js";
import { NotificationStore } from "./notification-store.js";

type NotificationMethod =
  | "notifications.list"
  | "notifications.read"
  | "notifications.read_all"
  | "notifications.read_session"
  | "notifications.dismiss"
  | "push.vapid.get"
  | "push.vapid.set"
  | "push.subscription.upsert"
  | "push.subscription.delete"
  | "push.deliveries.pending"
  | "push.delivery.record";

export function createNotificationHandlers(
  notifications: NotificationCenter,
  store: NotificationStore
): IpcHandlerMap<NotificationMethod> {
  return {
    "notifications.list": (raw) =>
      notifications.list(numberParam(asRecord(raw), "limit", 100)),
    "notifications.read": (raw) =>
      notifications.markRead(stringParam(asRecord(raw), "id")),
    "notifications.read_all": () => notifications.markAllRead(),
    "notifications.read_session": (raw) =>
      notifications.markSessionRead(stringParam(asRecord(raw), "sessionId")),
    "notifications.dismiss": (raw) =>
      notifications.dismiss(stringParam(asRecord(raw), "id")),
    "push.vapid.get": () => store.getVapidKeys(),
    "push.vapid.set": (raw) => {
      const params = asRecord(raw);
      return store.setVapidKeys({
        publicKey: stringParam(params, "publicKey"),
        privateKey: stringParam(params, "privateKey")
      });
    },
    "push.subscription.upsert": (raw) => {
      const params = asRecord(raw);
      return store.upsertSubscription({
        endpoint: stringParam(params, "endpoint"),
        p256dh: stringParam(params, "p256dh"),
        auth: stringParam(params, "auth"),
        userAgent: optionalString(params.userAgent)
      });
    },
    "push.subscription.delete": (raw) => ({
      deleted: store.deleteSubscription(
        stringParam(asRecord(raw), "endpoint")
      )
    }),
    "push.deliveries.pending": (raw) =>
      store.listPendingDeliveries(numberParam(asRecord(raw), "limit", 100)),
    "push.delivery.record": (raw) => {
      const params = asRecord(raw);
      store.recordDelivery(
        stringParam(params, "notificationId"),
        stringParam(params, "subscriptionId"),
        {
          delivered: params.delivered === true,
          errorSummary: optionalString(params.errorSummary)
        }
      );
      return { recorded: true };
    }
  };
}
