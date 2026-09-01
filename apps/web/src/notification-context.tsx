import type {
  NotificationRecord,
  NotificationSummary
} from "@pi-web/protocol";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren
} from "react";
import { api, isAbortError } from "./api";
import {
  loadNotificationPreferences,
  playCompletionSound
} from "./notifications";

interface NotificationContextValue extends NotificationSummary {
  loading: boolean;
  error: unknown;
  unreadSessionIds: Set<string>;
  refresh: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  markSessionRead: (sessionId: string) => Promise<void>;
  dismiss: (id: string) => Promise<void>;
}

const emptySummary: NotificationSummary = {
  notifications: [],
  unreadCount: 0,
  attentionCount: 0
};
const NotificationContext = createContext<NotificationContextValue | null>(null);

export function NotificationProvider({ children }: PropsWithChildren) {
  const [summary, setSummary] = useState<NotificationSummary>(emptySummary);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const refreshTimer = useRef<number | null>(null);
  const mounted = useRef(true);

  const applySummary = useCallback((next: NotificationSummary) => {
    if (!mounted.current) return;
    setSummary(next);
    setError(null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      applySummary(await api<NotificationSummary>("/api/notifications?limit=200"));
    } catch (reason) {
      if (!isAbortError(reason) && mounted.current) setError(reason);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [applySummary]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      if (refreshTimer.current !== null) {
        window.clearTimeout(refreshTimer.current);
        refreshTimer.current = null;
      }
    };
  }, [refresh]);

  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | null = null;
    let retryTimer: number | null = null;
    let retryMs = 500;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";

    function connect() {
      if (stopped) return;
      const next = new WebSocket(`${protocol}//${window.location.host}/api/ws`);
      socket = next;
      next.addEventListener("open", () => {
        retryMs = 500;
        void refresh();
      });
      next.addEventListener("message", (event) => {
        if (isNotificationRefreshMessage(event.data)) {
          void refresh();
          return;
        }
        const notification = parseNotificationSocketMessage(event.data);
        if (!notification) return;
        if (
          notification.readAt === null &&
          loadNotificationPreferences().sound
        ) {
          playCompletionSound(notification.severity === "error");
        }
        const scheduleAuthoritativeRefresh = () => {
          if (refreshTimer.current !== null) return;
          refreshTimer.current = window.setTimeout(() => {
            refreshTimer.current = null;
            void refresh();
          }, 50);
        };
        const visibleSession = visibleSessionId();
        if (
          visibleSession !== null &&
          notification.sessionId === visibleSession &&
          document.visibilityState === "visible" &&
          (typeof document.hasFocus !== "function" || document.hasFocus())
        ) {
          void api<NotificationRecord>(
            `/api/notifications/${encodeURIComponent(notification.id)}/read`,
            { method: "POST" }
          )
            .then((read) => {
              setSummary((current) => mergeNotification(current, read));
              scheduleAuthoritativeRefresh();
            })
            .catch(() => {
              setSummary((current) => mergeNotification(current, notification));
              scheduleAuthoritativeRefresh();
            });
          return;
        }
        setSummary((current) => mergeNotification(current, notification));
        scheduleAuthoritativeRefresh();
      });
      next.addEventListener("close", () => {
        if (stopped) return;
        retryTimer = window.setTimeout(connect, retryMs);
        retryMs = Math.min(5_000, retryMs * 2);
      });
    }

    connect();
    return () => {
      stopped = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      socket?.close();
    };
  }, [refresh]);

  const mutate = useCallback(
    async (path: string) => {
      applySummary(await api<NotificationSummary>(path, { method: "POST" }));
    },
    [applySummary]
  );
  const markRead = useCallback(
    async (id: string) => {
      const notification = await api<NotificationRecord>(
        `/api/notifications/${encodeURIComponent(id)}/read`,
        { method: "POST" }
      );
      setSummary((current) => mergeNotification(current, notification));
    },
    []
  );
  const markAllRead = useCallback(
    async () => await mutate("/api/notifications/read-all"),
    [mutate]
  );
  const markSessionRead = useCallback(
    async (sessionId: string) =>
      await mutate(
        `/api/notifications/session/${encodeURIComponent(sessionId)}/read`
      ),
    [mutate]
  );
  const dismiss = useCallback(async (id: string) => {
    const notification = await api<NotificationRecord>(
      `/api/notifications/${encodeURIComponent(id)}/dismiss`,
      { method: "POST" }
    );
    setSummary((current) => mergeNotification(current, notification));
  }, []);

  const unreadSessionIds = useMemo(
    () =>
      new Set(
        summary.notifications.flatMap((notification) =>
          notification.readAt === null &&
          notification.dismissedAt === null &&
          notification.sessionId
            ? [notification.sessionId]
            : []
        )
      ),
    [summary.notifications]
  );
  const value = useMemo<NotificationContextValue>(
    () => ({
      ...summary,
      loading,
      error,
      unreadSessionIds,
      refresh,
      markRead,
      markAllRead,
      markSessionRead,
      dismiss
    }),
    [
      dismiss,
      error,
      loading,
      markAllRead,
      markRead,
      markSessionRead,
      refresh,
      summary,
      unreadSessionIds
    ]
  );
  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications(): NotificationContextValue {
  const value = useContext(NotificationContext);
  if (!value) {
    throw new Error("useNotifications must be used inside NotificationProvider");
  }
  return value;
}

export function mergeNotification(
  current: NotificationSummary,
  incoming: NotificationRecord
): NotificationSummary {
  const existing = current.notifications.find((item) => item.id === incoming.id);
  const notifications = incoming.dismissedAt
    ? current.notifications.filter((item) => item.id !== incoming.id)
    : [
        incoming,
        ...current.notifications.filter((item) => item.id !== incoming.id)
      ].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return {
    notifications,
    unreadCount: Math.max(
      0,
      current.unreadCount - unreadContribution(existing) + unreadContribution(incoming)
    ),
    attentionCount: Math.max(
      0,
      current.attentionCount -
        attentionContribution(existing) +
        attentionContribution(incoming)
    )
  };
}

function unreadContribution(
  notification: NotificationRecord | undefined
): number {
  return notification &&
    notification.readAt === null &&
    notification.dismissedAt === null
    ? 1
    : 0;
}

function attentionContribution(
  notification: NotificationRecord | undefined
): number {
  return notification &&
    notification.requiresAction &&
    notification.resolvedAt === null &&
    notification.dismissedAt === null
    ? 1
    : 0;
}

function visibleSessionId(): string | null {
  const match = window.location.pathname.match(/^\/sessions\/([^/]+)$/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return null;
  }
}

function isNotificationRefreshMessage(data: unknown): boolean {
  if (typeof data !== "string") return false;
  try {
    const value = JSON.parse(data) as { type?: unknown };
    return value.type === "notification_refresh";
  } catch {
    return false;
  }
}

function parseNotificationSocketMessage(data: unknown): NotificationRecord | null {
  if (typeof data !== "string") return null;
  try {
    const value = JSON.parse(data) as {
      type?: unknown;
      notification?: unknown;
    };
    return value.type === "notification" && isNotification(value.notification)
      ? value.notification
      : null;
  } catch {
    return null;
  }
}

function isNotification(value: unknown): value is NotificationRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<NotificationRecord>;
  return (
    typeof record.id === "string" &&
    typeof record.kind === "string" &&
    typeof record.title === "string" &&
    typeof record.href === "string" &&
    typeof record.createdAt === "string"
  );
}
