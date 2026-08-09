import {
  Menu,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Settings
} from "lucide-react";
import type { ReactNode } from "react";
import { ButtonLink, IconButton } from "./components";
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
            <ButtonLink
              to="/"
              variant="toolbar"
              size="icon"
              aria-label={t("新建会话")}
              title={t("新建会话")}
            >
              <MessageSquarePlus size={17} />
            </ButtonLink>
            <ButtonLink
              to="/settings"
              variant="toolbar"
              size="icon"
              aria-label={t("设置")}
              title={t("设置")}
            >
              <Settings size={16} />
            </ButtonLink>
          </div>
        </header>
        <div className={ui("workspace-page-content")}>{children}</div>
      </section>
    </div>
  );
}
