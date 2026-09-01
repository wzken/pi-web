export interface NotificationRecord {
  id: string;
  kind:
    | "extension_interaction"
    | "session_settled"
    | "session_failed"
    | "schedule_failed";
  severity: "info" | "success" | "warning" | "error";
  title: string;
  body: string;
  href: string;
  sessionId: string | null;
  jobId: string | null;
  runId: string | null;
  requiresAction: boolean;
  readAt: string | null;
  resolvedAt: string | null;
  dismissedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationSummary {
  notifications: NotificationRecord[];
  unreadCount: number;
  attentionCount: number;
}

export interface PushSubscriptionRecord {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PushVapidKeys {
  publicKey: string;
  privateKey: string;
}

export interface PushDeliveryTarget {
  notification: NotificationRecord;
  subscription: PushSubscriptionRecord;
}
