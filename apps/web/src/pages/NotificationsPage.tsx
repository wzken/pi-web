import type { NotificationRecord } from "@pi-web/protocol";
import {
  Bell,
  BellRing,
  CheckCheck,
  CircleAlert,
  CircleCheck,
  Clock3,
  ExternalLink,
  Inbox,
  X
} from "lucide-react";
import { useMemo } from "react";
import { formatRelativeTime, t } from "../i18n";
import { Button, EmptyState, ErrorBanner, Loading } from "../components";
import { useNotifications } from "../notification-context";
import { Link, useSearchParams } from "../router";
import { ui } from "../ui";

type NotificationFilter = "all" | "attention" | "unread";

const filters: Array<{ value: NotificationFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "attention", label: "需处理" },
  { value: "unread", label: "未读" }
];

export function NotificationsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    notifications,
    unreadCount,
    attentionCount,
    loading,
    error,
    markRead,
    markAllRead,
    dismiss
  } = useNotifications();
  const filter = parseFilter(searchParams.get("filter"));
  const visible = useMemo(
    () =>
      notifications.filter((notification) => {
        if (filter === "unread") return notification.readAt === null;
        if (filter === "attention") {
          return notification.requiresAction && notification.resolvedAt === null;
        }
        return true;
      }),
    [filter, notifications]
  );

  function selectFilter(value: NotificationFilter) {
    const next = new URLSearchParams(searchParams);
    if (value === "all") next.delete("filter");
    else next.set("filter", value);
    setSearchParams(next);
  }

  if (loading && notifications.length === 0) {
    return <Loading label={t("读取通知")} />;
  }

  return (
    <section className={ui("redesign-page notifications-page")}>
      <header className={ui("redesign-page-heading")}>
        <div>
          <p className={ui("redesign-kicker")}>SUPERVISION INBOX</p>
          <h1>{t("通知中心")}</h1>
          <p>{t("集中处理等待决策、完成结果和运行异常。")}</p>
        </div>
        <Button
          variant="secondary"
          disabled={unreadCount === 0}
          onClick={() => void markAllRead()}
        >
          <CheckCheck size={16} aria-hidden="true" />
          {t("全部标为已读")}
        </Button>
      </header>

      {error !== null && <ErrorBanner error={error} />}

      <section className={ui("notification-metrics")} aria-label={t("通知概览")}>
        <article>
          <Inbox size={18} aria-hidden="true" />
          <span>{t("当前通知")}</span>
          <strong>{notifications.length}</strong>
        </article>
        <article>
          <Bell size={18} aria-hidden="true" />
          <span>{t("未读")}</span>
          <strong>{unreadCount}</strong>
        </article>
        <article data-attention={attentionCount > 0 ? "true" : undefined}>
          <CircleAlert size={18} aria-hidden="true" />
          <span>{t("需处理")}</span>
          <strong>{attentionCount}</strong>
        </article>
      </section>

      <div
        className={ui("redesign-session-filters notification-filters")}
        role="group"
        aria-label={t("筛选通知")}
      >
        {filters.map((item) => (
          <button
            key={item.value}
            type="button"
            className={ui("redesign-session-filter")}
            aria-pressed={filter === item.value}
            data-active={filter === item.value ? "true" : undefined}
            onClick={() => selectFilter(item.value)}
          >
            {t(item.label)}
            {item.value === "attention" && attentionCount > 0 ? (
              <span>{attentionCount}</span>
            ) : item.value === "unread" && unreadCount > 0 ? (
              <span>{unreadCount}</span>
            ) : null}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className={ui("redesign-empty-panel notification-empty")}>
          <EmptyState
            icon={<BellRing size={26} />}
            title={
              filter === "attention"
                ? t("没有等待处理的通知")
                : filter === "unread"
                  ? t("没有未读通知")
                  : t("通知中心是空的")
            }
          >
            {t("Pi 需要决策、完成工作或发生异常时会显示在这里。")}
          </EmptyState>
        </div>
      ) : (
        <div className={ui("notification-list")}>
          {visible.map((notification) => (
            <NotificationRow
              key={notification.id}
              notification={notification}
              onRead={() => void markRead(notification.id)}
              onDismiss={() => void dismiss(notification.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function NotificationRow({
  notification,
  onRead,
  onDismiss
}: {
  notification: NotificationRecord;
  onRead: () => void;
  onDismiss: () => void;
}) {
  const unread = notification.readAt === null;
  const activeAttention =
    notification.requiresAction && notification.resolvedAt === null;
  return (
    <article
      className={ui(
        `notification-row${unread ? " is-unread" : ""}${
          activeAttention ? " needs-attention" : ""
        }`
      )}
    >
      <span
        className={ui(`notification-kind severity-${notification.severity}`)}
        aria-hidden="true"
      >
        {notification.kind === "extension_interaction" ? (
          <CircleAlert size={19} />
        ) : notification.severity === "success" ? (
          <CircleCheck size={19} />
        ) : (
          <Bell size={19} />
        )}
      </span>
      <div className={ui("notification-copy")}>
        <div>
          <h2>{notificationTitle(notification)}</h2>
          {unread ? <span>{t("未读")}</span> : null}
          {activeAttention ? <span className={ui("notification-attention")}>{t("需处理")}</span> : null}
          {notification.resolvedAt ? <span>{t("已处理")}</span> : null}
        </div>
        <p>{notification.body}</p>
        <time dateTime={notification.createdAt}>
          <Clock3 size={12} aria-hidden="true" />
          {formatRelativeTime(notification.createdAt)}
        </time>
      </div>
      <div className={ui("notification-actions")}>
        <Link
          className={ui("notification-open")}
          to={notification.href}
          onClick={onRead}
        >
          {activeAttention ? t("立即处理") : t("打开")}
          <ExternalLink size={14} aria-hidden="true" />
        </Link>
        {unread ? (
          <button type="button" onClick={onRead}>
            <CheckCheck size={14} aria-hidden="true" />
            {t("标为已读")}
          </button>
        ) : null}
        <button type="button" onClick={onDismiss} aria-label={t("关闭通知")}>
          <X size={14} aria-hidden="true" />
          <span>{t("关闭")}</span>
        </button>
      </div>
    </article>
  );
}

function notificationTitle(notification: NotificationRecord): string {
  if (notification.kind === "extension_interaction") return t("Pi 正在等待你的决定");
  if (notification.kind === "session_settled") return t("Pi 已完成当前工作");
  if (notification.kind === "schedule_failed") return t("调度运行失败");
  return t("Pi 会话需要处理");
}

function parseFilter(value: string | null): NotificationFilter {
  return value === "attention" || value === "unread" ? value : "all";
}
