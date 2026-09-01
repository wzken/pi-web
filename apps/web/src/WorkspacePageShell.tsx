import {
  Bell,
  Menu,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen
} from "lucide-react";
import type { ReactNode } from "react";
import { ButtonLink, IconButton } from "./components";
import { useNotifications } from "./notification-context";
import { useLocation } from "./router";
import { t } from "./i18n";
import { SessionNavigator, useWorkbenchRail } from "./SessionNavigator";
import { ui } from "./ui";
import { useSessionList } from "./useSessionList";

export function WorkspacePageShell({
  title,
  children
}: {
  title: string;
  children: ReactNode;
}) {
  const { unreadCount, attentionCount } = useNotifications();
  const location = useLocation();
  const { sessions, setSessions } = useSessionList();
  const [railOpen, setRailOpen] = useWorkbenchRail();

  return (
    <div
      className={ui(
        `home-workbench workspace-page-shell${railOpen ? "" : " rail-collapsed"}`
      )}
    >
      {railOpen && (
        <>
          <SessionNavigator
            sessions={sessions ?? []}
            onClose={() => setRailOpen(false)}
            onSessionRenamed={(updated) =>
              setSessions((current) =>
                current?.map((session) =>
                  session.id === updated.id ? updated : session
                ) ?? null
              )
            }
            onSessionPinned={(updated) =>
              setSessions((current) =>
                current?.map((session) =>
                  session.id === updated.id ? updated : session
                ) ?? null
              )
            }
            onSessionDeleted={(sessionId) =>
              setSessions(
                (current) =>
                  current?.filter((session) => session.id !== sessionId) ?? null
              )
            }
          />
          <button
            className={ui("workbench-rail-backdrop")}
            aria-label={t("收起会话栏")}
            onClick={() => setRailOpen(false)}
          />
        </>
      )}

      <section className={ui("workspace-page-main")}>
        <header className={ui("workbench-topbar")}>
          <IconButton
            className={ui("workbench-rail-toggle")}
            label={railOpen ? t("收起会话栏") : t("展开会话栏")}
            variant="toolbar"
            aria-expanded={railOpen}
            onClick={() => setRailOpen((value) => !value)}
          >
            <span className={ui("desktop-rail-toggle-icon")}>
              {railOpen ? (
                <PanelLeftClose size={17} />
              ) : (
                <PanelLeftOpen size={17} />
              )}
            </span>
            <Menu
              className={ui("mobile-rail-toggle-icon")}
              size={22}
              aria-hidden="true"
            />
          </IconButton>
          <div className={ui("workbench-topbar-title")}>
            <strong>{title}</strong>
          </div>
          <div className={ui("workbench-topbar-actions")}>
            {location.pathname === "/sessions" ? (
              <ButtonLink
                to="/"
                variant="toolbar"
                size="sm"
                className={ui("workspace-primary-action")}
                aria-label={t("发起新会话")}
                title={t("发起新会话")}
              >
                <MessageSquarePlus size={17} />
                <span>{t("新会话")}</span>
              </ButtonLink>
            ) : location.pathname !== "/notifications" ? (
              <ButtonLink
                to="/notifications"
                variant="toolbar"
                size="icon"
                className={ui("notification-topbar-button")}
                aria-label={
                  unreadCount > 0
                    ? t("{{count}} 条未读通知", { count: unreadCount })
                    : t("通知中心")
                }
                title={t("通知中心")}
              >
                <Bell size={17} />
                {unreadCount > 0 ? (
                  <span
                    className={ui("notification-topbar-count")}
                    data-attention={attentionCount > 0 ? "true" : undefined}
                    aria-hidden="true"
                  >
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                ) : null}
              </ButtonLink>
            ) : null}
          </div>
        </header>
        <div className={ui("workspace-page-content")}>{children}</div>
      </section>
    </div>
  );
}
