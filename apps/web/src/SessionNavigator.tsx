import {
  Bell,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Command,
  Folder,
  FolderPlus,
  History,
  MessageSquarePlus,
  X
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction
} from "react";
import type { SessionRecord } from "@pi-web/protocol";
import { api, isAbortError } from "./api";
import { Button, IconButton, useToast } from "./components";
import { t } from "./i18n";
import { Link, useLocation, useNavigate } from "./router";
import { useNotifications } from "./notification-context";
import { ui } from "./ui";
import { AccountMenu } from "./AccountMenu";
import { DirectoryPicker } from "./DirectoryPicker";
import { SessionGroups } from "./features/session-navigation/SessionGroups";
import {
  buildSidebarProjects,
  buildStandaloneSessions,
  compareSidebarSessions,
  sameWorkspace,
  useSidebarSectionCollapsed,
  workspaceKey,
  type SidebarDirectory,
  type SidebarProject
} from "./features/session-navigation/session-navigation";

const railStorageKey = "pi-web:session-rail-open";
const projectSessionPreviewLimit = 5;

export function useWorkbenchRail(): [
  boolean,
  Dispatch<SetStateAction<boolean>>
] {
  const [open, setOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      if (window.matchMedia("(max-width: 760px)").matches) return false;
      return window.localStorage.getItem(railStorageKey) !== "false";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      if (window.matchMedia("(max-width: 760px)").matches) return;
      window.localStorage.setItem(railStorageKey, String(open));
    } catch {
      // The workbench still functions when browser storage is unavailable.
    }
  }, [open]);

  useEffect(() => {
    if (
      !open ||
      !window.matchMedia("(max-width: 760px)").matches
    ) {
      return;
    }
    const previous = document.activeElement as HTMLElement | null;
    const rail = document.querySelector<HTMLElement>(
      ".workbench-session-rail"
    );
    const closeButton = rail?.querySelector<HTMLElement>(
      ".workbench-rail-close"
    );
    const focusFrame = window.requestAnimationFrame(() =>
      focusCustomControl(closeButton)
    );
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !rail) return;
      const focusable = Array.from(
        rail.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex='-1'])"
        )
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      focusCustomControl(previous);
    };
  }, [open, setOpen]);

  return [open, setOpen];
}

function focusCustomControl(element: HTMLElement | null | undefined) {
  const shadowControl = element?.shadowRoot?.querySelector<HTMLElement>(
    "button, a, [tabindex]"
  );
  if (shadowControl) {
    shadowControl.focus();
    return;
  }
  if (element) HTMLElement.prototype.focus.call(element);
}

export function SessionNavigator({
  sessions,
  currentId,
  cwd,
  onClose,
  onSessionRenamed,
  onSessionPinned,
  onSessionDeleted
}: {
  sessions: SessionRecord[];
  currentId?: string | undefined;
  cwd?: string;
  onClose?: () => void;
  onSessionRenamed?: (session: SessionRecord) => void;
  onSessionPinned?: (session: SessionRecord) => void;
  onSessionDeleted?: (sessionId: string) => void;
}) {
  const workspaceHome = cwd ? `/?cwd=${encodeURIComponent(cwd)}` : "/";
  const location = useLocation();
  const [projectDirectories, setProjectDirectories] = useState<SidebarDirectory[]>([]);
  const { unreadCount, attentionCount } = useNotifications();

  useEffect(() => {
    const controller = new AbortController();
    api<SidebarDirectory[]>("/api/directories", { signal: controller.signal })
      .then((items) => setProjectDirectories(items.filter((item) => item.favorite)))
      .catch((reason) => {
        if (!isAbortError(reason)) setProjectDirectories([]);
      });
    return () => controller.abort();
  }, []);

  const projects = useMemo(
    () => buildSidebarProjects(sessions, projectDirectories, cwd),
    [cwd, projectDirectories, sessions]
  );
  const standaloneSessions = useMemo(
    () => buildStandaloneSessions(sessions, projects),
    [projects, sessions]
  );

  return (
    <aside className={ui("workbench-session-rail")}>
      <header className={ui("workbench-rail-brand")}>
        <div className={ui("codex-brand-lockup")}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={ui("codex-command-trigger")}
            aria-label={t("打开命令面板")}
            title={`${t("打开命令面板")} (Ctrl/⌘+K)`}
            onClick={() =>
              window.dispatchEvent(new Event("pi-web:open-command"))
            }
          >
            <img
              className={ui("pi-command-icon")}
              src="/pi-web.svg"
              width="16"
              height="16"
              alt=""
              aria-hidden="true"
            />
          </Button>
          <strong>Pi Web</strong>
        </div>
        <div className={ui("workbench-rail-actions")}>
          {onClose && (
            <IconButton
              className={ui("workbench-rail-close")}
              label={t("关闭任务侧栏")}
              variant="secondary"
              size="sm"
              onClick={() => {
                onClose();
                window.requestAnimationFrame(() =>
                  document
                    .querySelector<HTMLElement>(".workbench-rail-toggle")
                    ?.focus({ preventScroll: true })
                );
              }}
            >
              <X size={19} />
            </IconButton>
          )}
        </div>
      </header>

      <nav className={ui("codex-rail-nav")} aria-label={t("主导航")}>
        <Link
          className={ui(
            `codex-rail-link is-primary${location.pathname === "/" ? " is-active" : ""}`
          )}
          to={workspaceHome}
          aria-current={location.pathname === "/" ? "page" : undefined}
        >
          <MessageSquarePlus size={15} />
          <span>{t("新会话")}</span>
        </Link>
        <Link
          className={ui(
            `codex-rail-link${location.pathname.startsWith("/sessions") ? " is-active" : ""}`
          )}
          to="/sessions"
          aria-current={location.pathname.startsWith("/sessions") ? "page" : undefined}
        >
          <History size={15} />
          <span>{t("会话")}</span>
        </Link>
        <Link
          className={ui(
            `codex-rail-link${location.pathname === "/notifications" ? " is-active" : ""}`
          )}
          to="/notifications"
          aria-current={location.pathname === "/notifications" ? "page" : undefined}
        >
          <Bell size={15} />
          <span>{t("通知")}</span>
          {unreadCount > 0 ? (
            <strong
              className={ui("rail-notification-count")}
              data-attention={attentionCount > 0 ? "true" : undefined}
              aria-label={t("{{count}} 条未读通知", { count: unreadCount })}
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </strong>
          ) : null}
        </Link>
        <Link
          className={ui(
            `codex-rail-link${location.pathname === "/pi" ? " is-active" : ""}`
          )}
          to="/pi"
          aria-current={location.pathname === "/pi" ? "page" : undefined}
        >
          <Command size={15} />
          <span>{t("Pi 管理")}</span>
        </Link>
        <Link
          className={ui(
            `codex-rail-link${location.pathname === "/schedules" ? " is-active" : ""}`
          )}
          to="/schedules"
          aria-current={location.pathname === "/schedules" ? "page" : undefined}
        >
          <CalendarClock size={15} />
          <span>{t("调度")}</span>
        </Link>
      </nav>

      <div className={ui("workbench-rail-scroll")}>
        <ProjectGroups
          projects={projects}
          currentId={currentId}
          {...(cwd ? { currentCwd: cwd } : {})}
          onProjectAdded={(path) => {
            setProjectDirectories((items) =>
              items.some((item) => sameWorkspace(item.path, path))
                ? items
                : [...items, { path, alias: null, favorite: true, lastUsedAt: new Date().toISOString() }]
            );
          }}
        />

        <SessionGroups
          sessions={standaloneSessions}
          currentId={currentId}
          onSessionRenamed={onSessionRenamed}
          onSessionPinned={onSessionPinned}
          onSessionDeleted={onSessionDeleted}
        />
      </div>

      <footer className={ui("workbench-rail-footer")}>
        <AccountMenu />
      </footer>
    </aside>
  );
}

function ProjectGroups({
  projects,
  currentId,
  currentCwd,
  onProjectAdded
}: {
  projects: SidebarProject[];
  currentId?: string | undefined;
  currentCwd?: string;
  onProjectAdded: (path: string) => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const [collapsed, setCollapsed] = useSidebarSectionCollapsed("projects");
  const [pickerRoots, setPickerRoots] = useState<string[] | null>(null);
  const [pickerBusy, setPickerBusy] = useState(false);
  const unreadSessions = useNotifications().unreadSessionIds;
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
  const visibleProjects = projects;

  async function openProjectPicker() {
    if (pickerBusy) return;
    setPickerBusy(true);
    try {
      const settings = await api<{ allowedRoots: string[] }>("/api/settings");
      if (settings.allowedRoots.length === 0) {
        toast.push(t("先在设置中配置允许目录"), "error");
        return;
      }
      setPickerRoots(settings.allowedRoots);
      setCollapsed(false);
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setPickerBusy(false);
    }
  }

  return (
    <section className={ui(`project-groups${collapsed ? " is-collapsed" : ""}`)}>
      <div className={ui("sidebar-section-heading")}>
        <button
          type="button"
          className={ui("sidebar-section-toggle")}
          aria-expanded={!collapsed}
          aria-label={collapsed ? t("展开项目") : t("折叠项目")}
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          <span>{t("项目")}</span>
        </button>
        <IconButton
          className={ui("sidebar-section-action")}
          label={t("添加项目")}
          size="sm"
          disabled={pickerBusy}
          onClick={() => void openProjectPicker()}
        >
          <FolderPlus size={14} aria-hidden="true" />
        </IconButton>
      </div>

      {!collapsed && (
        <>
          <div className={ui("project-list")}>
            {visibleProjects.map((project) => {
              const key = workspaceKey(project.cwd);
              const projectCollapsed = collapsedProjects.has(key);
              const sortedSessions = [...project.sessions].sort(compareSidebarSessions);
              const preview = sortedSessions.slice(0, projectSessionPreviewLimit);
              const active = currentId
                ? sortedSessions.find((session) => session.id === currentId)
                : undefined;
              const visibleSessions = active && !preview.some((session) => session.id === active.id)
                ? [...preview.slice(0, projectSessionPreviewLimit - 1), active]
                : preview;
              return (
                <div className={ui("project-tree")} key={key}>
                  <div
                    className={ui(
                      `project-row${sameWorkspace(project.cwd, currentCwd ?? "") ? " is-active" : ""}`
                    )}
                    title={project.cwd}
                  >
                    <button
                      type="button"
                      className={ui("project-row-collapse")}
                      aria-label={projectCollapsed ? t("展开项目") : t("折叠项目")}
                      aria-expanded={!projectCollapsed}
                      onClick={() => setCollapsedProjects((items) => {
                        const next = new Set(items);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      })}
                    >
                      {projectCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                    </button>
                    <Link
                      className={ui("project-row-open")}
                      to={`/?cwd=${encodeURIComponent(project.cwd)}`}
                      aria-label={`${t("新建会话")} · ${project.name}`}
                    >
                      <Folder size={13} aria-hidden="true" />
                      <span>{project.name}</span>
                      <small>{project.sessionCount}</small>
                    </Link>
                    <Link
                      className={ui("project-new-session")}
                      to={`/?cwd=${encodeURIComponent(project.cwd)}`}
                      aria-label={`${t("新建会话")} · ${project.name}`}
                      title={t("新建会话")}
                    >
                      <MessageSquarePlus size={13} />
                    </Link>
                  </div>
                  {!projectCollapsed && (
                    <div className={ui("project-session-list")}>
                      {visibleSessions.map((session) => (
                        <Link
                          className={ui(`project-session-link${session.id === currentId ? " is-active" : ""}`)}
                          key={session.id}
                          to={`/sessions/${encodeURIComponent(session.id)}`}
                          title={session.displayName}
                        >
                          <span>{session.displayName}</span>
                          {unreadSessions.has(session.id) && <i aria-label={t("未读")} />}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {projects.length === 0 && (
              <p className={ui("project-list-empty")}>{t("还没有项目")}</p>
            )}
          </div>
        </>
      )}
      {pickerRoots && (
        <DirectoryPicker
          roots={pickerRoots}
          value={currentCwd ?? pickerRoots[0] ?? ""}
          autoOpen
          hideTrigger
          onClose={() => setPickerRoots(null)}
          onChange={(path) => {
            setPickerRoots(null);
            onProjectAdded(path);
            navigate(`/?cwd=${encodeURIComponent(path)}`);
          }}
        />
      )}
    </section>
  );
}
