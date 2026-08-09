import {
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  Command,
  Folder,
  FolderInput,
  FolderPlus,
  MessageSquarePlus,
  Pencil,
  Pin,
  Puzzle,
  Trash2,
  X
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction
} from "react";
import type {
  SessionFolder,
  SessionFolderState,
  SessionRecord
} from "@pi-web/protocol";
import { api, isAbortError, jsonBody } from "./api";
import {
  ActionMenu,
  ActionMenuItem,
  Button,
  ButtonLink,
  Dialog,
  IconButton,
  useToast
} from "./components";
import { formatRelativeTime, t } from "./i18n";
import { Link, useNavigate } from "./router";
import { useUnreadSessions } from "./useUnreadSessions";
import { ui } from "./ui";
import { AccountMenu } from "./AccountMenu";
import { DirectoryPicker } from "./DirectoryPicker";

const railStorageKey = "pi-web:session-rail-open";
const sidebarSectionStoragePrefix = "pi-web:sidebar-section:";
const projectPreviewLimit = 3;
const projectSessionPreviewLimit = 5;
const chatPreviewLimit = 5;

export interface SidebarDirectory {
  path: string;
  alias: string | null;
  favorite: boolean;
  lastUsedAt: string;
}

export interface SidebarProject {
  cwd: string;
  name: string;
  sessionCount: number;
  updatedAt: string;
  sessions: SessionRecord[];
}

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
  const [projectDirectories, setProjectDirectories] = useState<SidebarDirectory[]>([]);

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
            <Command size={16} />
          </Button>
          <strong>Pi Web</strong>
        </div>
        <div className={ui("workbench-rail-actions")}>
          <ButtonLink
            to={workspaceHome}
            variant="toolbar"
            size="sm"
            tooltip={t("新会话")}
            aria-label={t("新建会话")}
          >
            <MessageSquarePlus size={15} />
            <span>{t("新建")}</span>
          </ButtonLink>
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
        <Link className={ui("codex-rail-link is-primary")} to={workspaceHome}>
          <MessageSquarePlus size={15} />
          <span>{t("新会话")}</span>
        </Link>
        <Link className={ui("codex-rail-link")} to="/pi?tab=packages">
          <Puzzle size={15} />
          <span>{t("插件")}</span>
        </Link>
        <Link className={ui("codex-rail-link")} to="/schedules">
          <CalendarClock size={15} />
          <span>{t("调度")}</span>
        </Link>
      </nav>

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

      <footer className={ui("workbench-rail-footer")}>
        <ButtonLink
          className={ui("mobile-rail-new")}
          to={workspaceHome}
          variant="primary"
          size="sm"
          aria-label={t("新建会话")}
        >
          <MessageSquarePlus size={19} />
          <span>{t("新会话")}</span>
        </ButtonLink>
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
  const unreadSessions = useUnreadSessions();
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
  const visibleProjects = projects.slice(0, projectPreviewLimit);

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
          label={t("新建项目")}
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
                      className={ui("project-row-toggle")}
                      aria-expanded={!projectCollapsed}
                      onClick={() => setCollapsedProjects((items) => {
                        const next = new Set(items);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      })}
                    >
                      {projectCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                      <Folder size={13} aria-hidden="true" />
                      <span>{project.name}</span>
                      <small>{project.sessionCount}</small>
                    </button>
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
          {projects.length > projectPreviewLimit && (
            <Link className={ui("sidebar-section-more")} to="/sessions">
              {t("查看全部项目")}
            </Link>
          )}
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

function SessionGroups({
  sessions,
  currentId,
  onSessionRenamed,
  onSessionPinned,
  onSessionDeleted
}: {
  sessions: SessionRecord[];
  currentId?: string | undefined;
  onSessionRenamed: ((session: SessionRecord) => void) | undefined;
  onSessionPinned: ((session: SessionRecord) => void) | undefined;
  onSessionDeleted: ((sessionId: string) => void) | undefined;
}) {
  const [folders, setFolders] = useState<SessionFolderState | null>(null);
  const [sectionCollapsed, setSectionCollapsed] =
    useSidebarSectionCollapsed("chats");
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(
    new Set()
  );
  const [renamedSessions, setRenamedSessions] = useState<
    Record<string, SessionRecord>
  >({});
  const [renaming, setRenaming] = useState<SessionRecord | null>(null);
  const [contextSession, setContextSession] = useState<SessionRecord | null>(null);
  const [deleting, setDeleting] = useState<SessionRecord | null>(null);
  const [deletedSessionIds, setDeletedSessionIds] = useState<Set<string>>(
    new Set()
  );
  const [sessionActionBusy, setSessionActionBusy] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState<SessionFolder | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();
  const unreadSessions = useUnreadSessions();

  useEffect(() => {
    if (!contextSession) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusFrame = window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(".mobile-session-context-menu button")
        ?.focus({ preventScroll: true });
    });
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setContextSession(null);
        return;
      }
      if (event.key !== "Tab") return;
      const buttons = Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          ".mobile-session-context-menu button:not(:disabled)"
        )
      );
      if (buttons.length === 0) return;
      const first = buttons[0]!;
      const last = buttons.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", closeOnEscape);
      previous?.focus({ preventScroll: true });
    };
  }, [contextSession]);

  useEffect(() => {
    const controller = new AbortController();
    api<SessionFolderState>("/api/session-folders", {
      signal: controller.signal
    })
      .then(setFolders)
      .catch((reason) => {
        if (!isAbortError(reason)) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });
    return () => controller.abort();
  }, []);

  const visibleSessions = useMemo(
    () => {
      const renamed = sessions.map(
        (session) => renamedSessions[session.id] ?? session
      ).filter((session) => !deletedSessionIds.has(session.id));
      renamed.sort(compareSidebarSessions);
      const preview = renamed.slice(0, chatPreviewLimit);
      const active = currentId
        ? renamed.find((session) => session.id === currentId)
        : undefined;
      if (!active || preview.some((session) => session.id === active.id)) {
        return preview;
      }
      return [...preview.slice(0, chatPreviewLimit - 1), active];
    },
    [currentId, deletedSessionIds, renamedSessions, sessions]
  );

  const grouped = useMemo(() => {
    const byFolder = new Map<string, SessionRecord[]>();
    const unfiled: SessionRecord[] = [];
    for (const session of visibleSessions) {
      const folderId = folders?.assignments[session.id];
      if (!folderId || !folders?.folders.some((folder) => folder.id === folderId)) {
        unfiled.push(session);
        continue;
      }
      const items = byFolder.get(folderId) ?? [];
      items.push(session);
      byFolder.set(folderId, items);
    }
    return { byFolder, unfiled };
  }, [folders, visibleSessions]);
  const previewFolders = useMemo(() => {
    if (!folders) return [];
    const activeFolderId = currentId
      ? folders.assignments[currentId]
      : undefined;
    const withChats = folders.folders.filter(
      (folder) => (grouped.byFolder.get(folder.id)?.length ?? 0) > 0
    );
    const empty = folders.folders.filter(
      (folder) => (grouped.byFolder.get(folder.id)?.length ?? 0) === 0
    );
    return [...withChats, ...empty]
      .sort((left, right) => {
        if (left.id === activeFolderId) return -1;
        if (right.id === activeFolderId) return 1;
        return 0;
      })
      .slice(0, 3);
  }, [currentId, folders, grouped]);

  function beginRename(session: SessionRecord) {
    setRenaming(session);
    setRenameValue(session.displayName);
    setRenameError("");
  }

  async function renameSession() {
    const displayName = renameValue.trim();
    if (!renaming || !displayName || renameBusy) return;
    setRenameBusy(true);
    setRenameError("");
    try {
      const updated = await api<SessionRecord>(
        `/api/sessions/${encodeURIComponent(renaming.id)}`,
        {
          method: "PATCH",
          ...jsonBody({ displayName })
        }
      );
      setRenamedSessions((current) => ({
        ...current,
        [updated.id]: updated
      }));
      onSessionRenamed?.(updated);
      setRenaming(null);
      toast.push(t("会话名称已更新"));
    } catch (reason) {
      setRenameError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRenameBusy(false);
    }
  }

  async function togglePinnedSession(session: SessionRecord) {
    if (sessionActionBusy) return;
    setSessionActionBusy(true);
    setError("");
    try {
      const updated = await api<SessionRecord>(
        `/api/sessions/${encodeURIComponent(session.id)}/pin`,
        {
          method: "PUT",
          ...jsonBody({ pinned: !session.pinned })
        }
      );
      setRenamedSessions((current) => ({
        ...current,
        [updated.id]: updated
      }));
      onSessionPinned?.(updated);
      setContextSession(null);
      toast.push(updated.pinned ? t("会话已置顶") : t("已取消置顶"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSessionActionBusy(false);
    }
  }

  async function deleteSession() {
    if (!deleting || sessionActionBusy) return;
    setSessionActionBusy(true);
    setError("");
    try {
      await api<{ deleted: true }>(
        `/api/sessions/${encodeURIComponent(deleting.id)}`,
        { method: "DELETE" }
      );
      setDeletedSessionIds((current) => new Set(current).add(deleting.id));
      setFolders((current) => {
        if (!current) return current;
        const assignments = { ...current.assignments };
        delete assignments[deleting.id];
        return { ...current, assignments };
      });
      onSessionDeleted?.(deleting.id);
      setDeleting(null);
      toast.push(t("会话已删除"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSessionActionBusy(false);
    }
  }

  async function createFolder() {
    const value = name.trim();
    if (!value || busy) return;
    setBusy(true);
    setError("");
    try {
      const next = await api<SessionFolderState>("/api/session-folders", {
        method: "POST",
        ...jsonBody({ name: value })
      });
      setFolders(next);
      setName("");
      setCreating(false);
      toast.push(t("对话文件夹已创建"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function assign(sessionId: string, folderId: string | null) {
    setError("");
    try {
      setFolders(
        await api<SessionFolderState>(
          `/api/session-folders/assign/${encodeURIComponent(sessionId)}`,
          { method: "PUT", ...jsonBody({ folderId }) }
        )
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function removeFolder(folder: SessionFolder) {
    if (!confirm(t("删除对话文件夹“{{name}}”？其中的会话会移回未分类。", {
      name: folder.name
    }))) {
      return;
    }
    setError("");
    try {
      setFolders(
        await api<SessionFolderState>(
          `/api/session-folders/${encodeURIComponent(folder.id)}`,
          { method: "DELETE" }
        )
      );
      toast.push(t("对话文件夹已删除"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function renameFolder() {
    const nextName = renameValue.trim();
    if (!renamingFolder || !nextName || renameBusy) return;
    setRenameBusy(true);
    setRenameError("");
    try {
      const next = await api<SessionFolderState>(
        `/api/session-folders/${encodeURIComponent(renamingFolder.id)}`,
        {
          method: "PUT",
          ...jsonBody({ name: nextName })
        }
      );
      setFolders(next);
      setRenamingFolder(null);
      toast.push(t("对话文件夹已重命名"));
    } catch (reason) {
      setRenameError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRenameBusy(false);
    }
  }

  function toggleFolder(id: string) {
    setCollapsedFolders((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section
      className={ui(
        `session-groups${sectionCollapsed ? " is-collapsed" : ""}`
      )}
    >
      <div className={ui("session-groups-heading")}>
        <button
          type="button"
          className={ui("sidebar-section-toggle")}
          aria-expanded={!sectionCollapsed}
          aria-label={sectionCollapsed ? t("展开聊天") : t("折叠聊天")}
          onClick={() => setSectionCollapsed((value) => !value)}
        >
          {sectionCollapsed ? (
            <ChevronRight size={13} />
          ) : (
            <ChevronDown size={13} />
          )}
          <span className={ui("desktop-section-label")}>{t("聊天")}</span>
          <span className={ui("mobile-section-label")}>{t("最近")}</span>
        </button>
        <IconButton
          label={t("创建对话文件夹")}
          size="sm"
          onClick={() => {
            setSectionCollapsed(false);
            setCreating(true);
          }}
        >
          <FolderPlus size={14} />
        </IconButton>
      </div>

      {!sectionCollapsed && <div className={ui("session-groups-feedback")}>
        {creating && (
          <div className={ui("session-folder-create")}>
            <input
              autoFocus
              value={name}
              maxLength={80}
              aria-label={t("对话文件夹名称")}
              placeholder={t("文件夹名称")}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void createFolder();
                if (event.key === "Escape") {
                  setCreating(false);
                  setName("");
                }
              }}
            />
            <IconButton
              label={t("保存文件夹")}
              size="sm"
              disabled={busy || !name.trim()}
              onClick={() => void createFolder()}
            >
              <Check size={13} />
            </IconButton>
            <IconButton
              label={t("取消创建")}
              size="sm"
              onClick={() => {
                setCreating(false);
                setName("");
              }}
            >
              <X size={13} />
            </IconButton>
          </div>
        )}

        {error && (
          <div className={ui("session-folder-error")} role="alert">
            {error}
          </div>
        )}
      </div>}

      {!sectionCollapsed && <div className={ui("session-group-list")}>
        {previewFolders.map((folder) => {
          const items = grouped.byFolder.get(folder.id) ?? [];
          const isCollapsed = collapsedFolders.has(folder.id);
          return (
            <section className={ui("conversation-folder")} key={folder.id}>
              <div className={ui("conversation-folder-heading")}>
                <button
                  type="button"
                  onClick={() => toggleFolder(folder.id)}
                  aria-expanded={!isCollapsed}
                  aria-label={`${folder.name} ${t("{{count}} 个会话", {
                    count: items.length
                  })}`}
                >
                  {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                  <Folder size={13} />
                  <span>{folder.name}</span>
                  <small>{items.length}</small>
                </button>
                <ActionMenu label={t("文件夹操作 {{name}}", { name: folder.name })}>
                  <ActionMenuItem
                    onClick={() => {
                      setRenamingFolder(folder);
                      setRenameValue(folder.name);
                      setRenameError("");
                    }}
                  >
                    <Pencil size={13} />
                    {t("重命名")}
                  </ActionMenuItem>
                  <ActionMenuItem
                    danger
                    onClick={() => void removeFolder(folder)}
                  >
                    <Trash2 size={13} />
                    {t("删除文件夹")}
                  </ActionMenuItem>
                </ActionMenu>
              </div>
              {!isCollapsed &&
                items.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    currentId={currentId}
                    folders={folders}
                    onAssign={assign}
                    onRename={beginRename}
                    onOpenContext={setContextSession}
                    unread={unreadSessions.has(session.id)}
                  />
                ))}
            </section>
          );
        })}

        {(grouped.unfiled.length > 0 || folders?.folders.length === 0) && (
          <section className={ui("conversation-folder unfiled-folder")}>
            {folders && folders.folders.length > 0 && (
              <div className={ui("conversation-folder-heading static")}>
                <span><ChevronDown size={13} /><Folder size={13} />{t("未分类")}</span>
                <small>{grouped.unfiled.length}</small>
              </div>
            )}
            {grouped.unfiled.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                currentId={currentId}
                folders={folders}
                onAssign={assign}
                onRename={beginRename}
                onOpenContext={setContextSession}
                unread={unreadSessions.has(session.id)}
              />
            ))}
          </section>
        )}

        {visibleSessions.length === 0 && (
          <p className={ui("session-groups-empty")}>
            {t("第一条任务会自动建立并启动 Pi 会话。")}
          </p>
        )}
      </div>}

      {!sectionCollapsed && (
        <Link className={ui("session-groups-more")} to="/sessions">
          {t("查看全部会话")}
        </Link>
      )}

      {contextSession && (
        <div
          className={ui("mobile-session-context-backdrop")}
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setContextSession(null);
          }}
        >
          <div
            className={ui("mobile-session-context-menu")}
            role="menu"
            aria-label={t("会话操作 {{name}}", {
              name: contextSession.displayName
            })}
          >
            <button
              type="button"
              role="menuitem"
              disabled={sessionActionBusy}
              onClick={() => void togglePinnedSession(contextSession)}
            >
              <Pin size={22} />
              <span>{contextSession.pinned ? t("取消置顶") : t("置顶")}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={sessionActionBusy}
              onClick={() => {
                beginRename(contextSession);
                setContextSession(null);
              }}
            >
              <Pencil size={22} />
              <span>{t("重命名")}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className={ui("is-danger")}
              disabled={sessionActionBusy}
              onClick={() => {
                setDeleting(contextSession);
                setContextSession(null);
              }}
            >
              <Trash2 size={22} />
              <span>{t("删除")}</span>
            </button>
          </div>
        </div>
      )}

      <Dialog
        open={deleting !== null}
        labelledBy="delete-session-title"
        className={ui("session-delete-dialog")}
        maxWidth={420}
        onClose={() => {
          if (!sessionActionBusy) setDeleting(null);
        }}
      >
        <div>
          <header className={ui("dialog-heading")}>
            <div>
              <p className={ui("eyebrow")}>SESSION</p>
              <h2 id="delete-session-title">{t("删除会话")}</h2>
            </div>
          </header>
          <p>
            {t("确定删除会话“{{name}}”？这会从会话列表中移除，但不会删除原始 Pi 记录。", {
              name: deleting?.displayName ?? ""
            })}
          </p>
          <div className={ui("dialog-actions")}>
            <Button
              type="button"
              variant="secondary"
              disabled={sessionActionBusy}
              onClick={() => setDeleting(null)}
            >
              {t("取消")}
            </Button>
            <Button
              type="button"
              variant="danger"
              loading={sessionActionBusy}
              loadingLabel={t("删除中…")}
              onClick={() => void deleteSession()}
            >
              {t("删除")}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={renaming !== null}
        labelledBy="rename-session-title"
        className={ui("session-rename-dialog")}
        maxWidth={420}
        onClose={() => {
          if (!renameBusy) setRenaming(null);
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void renameSession();
          }}
        >
          <header className={ui("dialog-heading")}>
            <div>
              <p className={ui("eyebrow")}>SESSION</p>
              <h2 id="rename-session-title">{t("重命名会话")}</h2>
            </div>
            <IconButton
              label={t("关闭重命名对话框")}
              size="sm"
              disabled={renameBusy}
              onClick={() => setRenaming(null)}
            >
              <X size={16} />
            </IconButton>
          </header>
          <label className={ui("field")}>
            <span>{t("会话名称")}</span>
            <input
              autoFocus
              value={renameValue}
              maxLength={160}
              aria-describedby={renameError ? "rename-session-error" : undefined}
              onChange={(event) => setRenameValue(event.target.value)}
            />
          </label>
          {renameError && (
            <p
              className={ui("session-folder-error")}
              id="rename-session-error"
              role="alert"
            >
              {renameError}
            </p>
          )}
          <div className={ui("dialog-actions")}>
            <Button
              type="button"
              variant="secondary"
              disabled={renameBusy}
              onClick={() => setRenaming(null)}
            >
              {t("取消")}
            </Button>
            <Button
              type="submit"
              loading={renameBusy}
              loadingLabel={t("保存中…")}
              disabled={!renameValue.trim()}
            >
              {t("保存名称")}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={renamingFolder !== null}
        labelledBy="rename-folder-title"
        className={ui("session-rename-dialog")}
        maxWidth={420}
        onClose={() => {
          if (!renameBusy) setRenamingFolder(null);
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void renameFolder();
          }}
        >
          <header className={ui("dialog-heading")}>
            <div>
              <p className={ui("eyebrow")}>SESSION FOLDER</p>
              <h2 id="rename-folder-title">{t("重命名对话文件夹")}</h2>
            </div>
            <IconButton
              label={t("关闭重命名文件夹")}
              disabled={renameBusy}
              onClick={() => setRenamingFolder(null)}
            >
              <X size={16} />
            </IconButton>
          </header>
          <label className={ui("field")}>
            <span>{t("文件夹名称")}</span>
            <input
              value={renameValue}
              maxLength={80}
              onChange={(event) => setRenameValue(event.target.value)}
            />
          </label>
          {renameError && (
            <p className={ui("session-folder-error")} role="alert">{renameError}</p>
          )}
          <div className={ui("dialog-actions")}>
            <Button
              type="button"
              variant="secondary"
              disabled={renameBusy}
              onClick={() => setRenamingFolder(null)}
            >
              {t("取消")}
            </Button>
            <Button
              type="submit"
              loading={renameBusy}
              loadingLabel={t("保存中…")}
              disabled={!renameValue.trim()}
            >
              {t("保存名称")}
            </Button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}

function SessionRow({
  session,
  currentId,
  folders,
  onAssign,
  onRename,
  onOpenContext,
  unread
}: {
  session: SessionRecord;
  currentId?: string | undefined;
  folders: SessionFolderState | null;
  onAssign: (sessionId: string, folderId: string | null) => Promise<void>;
  onRename: (session: SessionRecord) => void;
  onOpenContext: (session: SessionRecord) => void;
  unread: boolean;
}) {
  const folderId = folders?.assignments[session.id] ?? "";
  const longPressTimer = useRef<number | null>(null);
  const pointerOrigin = useRef<{ x: number; y: number } | null>(null);
  const suppressNavigation = useRef(false);

  function clearLongPress() {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    pointerOrigin.current = null;
  }

  useEffect(() => clearLongPress, []);

  function beginLongPress(event: ReactPointerEvent<HTMLAnchorElement>) {
    if (event.pointerType === "mouse" || !event.isPrimary) return;
    clearLongPress();
    pointerOrigin.current = { x: event.clientX, y: event.clientY };
    longPressTimer.current = window.setTimeout(() => {
      suppressNavigation.current = true;
      onOpenContext(session);
      longPressTimer.current = null;
    }, 480);
  }

  return (
    <div
      className={ui(`session-nav-row${session.id === currentId ? " is-active" : ""}${
        unread ? " is-unread" : ""
      }`)}
    >
      <Link
        to={`/sessions/${session.id}`}
        aria-label={`${session.displayName}${unread ? t("，有未读通知") : ""}`}
        onClick={(event) => {
          if (!suppressNavigation.current) return;
          event.preventDefault();
          suppressNavigation.current = false;
        }}
        onContextMenu={(event) => {
          if (!window.matchMedia("(max-width: 760px)").matches) return;
          event.preventDefault();
          clearLongPress();
          suppressNavigation.current = true;
          onOpenContext(session);
        }}
        onPointerDown={beginLongPress}
        onPointerMove={(event) => {
          const origin = pointerOrigin.current;
          if (!origin) return;
          if (
            Math.abs(event.clientX - origin.x) > 10 ||
            Math.abs(event.clientY - origin.y) > 10
          ) {
            clearLongPress();
          }
        }}
        onPointerUp={clearLongPress}
        onPointerCancel={clearLongPress}
        onPointerLeave={clearLongPress}
      >
        <span>{session.displayName}</span>
        <small>{formatRelativeTime(session.updatedAt)}</small>
        <i className={ui(`session-nav-status status-${session.status}`)} />
        {unread && <i className={ui("session-unread-dot")} aria-hidden="true" />}
      </Link>
      <div className={ui("session-row-actions")}>
        <ActionMenu label={t("会话操作 {{name}}", { name: session.displayName })}>
          <ActionMenuItem onClick={() => onRename(session)}>
            <Pencil size={13} />
            {t("重命名")}
          </ActionMenuItem>
          {folders && folders.folders.length > 0 && (
            <>
              <div className={ui("action-menu-label")}>
                <FolderInput size={13} />
                {t("移动到")}
              </div>
              <ActionMenuItem
                active={!folderId}
                onClick={() => void onAssign(session.id, null)}
              >
                <Check
                  size={13}
                  className={ui(!folderId ? "" : "menu-check-placeholder")}
                />
                {t("未分类")}
              </ActionMenuItem>
              {folders.folders.map((folder) => (
                <ActionMenuItem
                  active={folder.id === folderId}
                  key={folder.id}
                  onClick={() => void onAssign(session.id, folder.id)}
                >
                  <Check
                    size={13}
                    className={ui(folder.id === folderId ? "" : "menu-check-placeholder")}
                  />
                  {folder.name}
                </ActionMenuItem>
              ))}
            </>
          )}
        </ActionMenu>
      </div>
    </div>
  );
}

export function buildSidebarProjects(
  sessions: SessionRecord[],
  directories: SidebarDirectory[],
  currentCwd?: string
): SidebarProject[] {
  const projects = new Map<string, SidebarProject>();
  for (const directory of directories.filter((item) => item.favorite)) {
    const key = workspaceKey(directory.path);
    projects.set(key, {
      cwd: directory.path,
      name: directory.alias?.trim() || projectName(directory.path),
      sessionCount: 0,
      updatedAt: directory.lastUsedAt,
      sessions: []
    });
  }
  for (const session of sessions) {
    const key = workspaceKey(session.cwd);
    const project = projects.get(key);
    if (!project) continue;
    project.sessions.push(session);
    project.sessionCount += 1;
    if (session.updatedAt > project.updatedAt) project.updatedAt = session.updatedAt;
  }
  return [...projects.values()].sort((left, right) => {
    const leftCurrent = currentCwd
      ? sameWorkspace(left.cwd, currentCwd)
      : false;
    const rightCurrent = currentCwd
      ? sameWorkspace(right.cwd, currentCwd)
      : false;
    if (leftCurrent !== rightCurrent) return leftCurrent ? -1 : 1;
    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

export function buildStandaloneSessions(
  sessions: SessionRecord[],
  projects: SidebarProject[]
): SessionRecord[] {
  const projectKeys = new Set(projects.map((project) => workspaceKey(project.cwd)));
  return sessions.filter((session) => !projectKeys.has(workspaceKey(session.cwd)));
}

export function compareSidebarSessions(
  left: SessionRecord,
  right: SessionRecord
): number {
  if (Boolean(left.pinned) !== Boolean(right.pinned)) {
    return left.pinned ? -1 : 1;
  }
  if (left.pinned && right.pinned) {
    const pinnedOrder = (right.pinnedAt ?? right.updatedAt).localeCompare(
      left.pinnedAt ?? left.updatedAt
    );
    if (pinnedOrder !== 0) return pinnedOrder;
  }
  return right.updatedAt.localeCompare(left.updatedAt);
}

function useSidebarSectionCollapsed(
  section: "projects" | "chats"
): [boolean, Dispatch<SetStateAction<boolean>>] {
  const storageKey = `${sidebarSectionStoragePrefix}${section}`;
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(storageKey) === "true";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, String(collapsed));
    } catch {
      // Sidebar sections still work when browser storage is unavailable.
    }
  }, [collapsed, storageKey]);
  return [collapsed, setCollapsed];
}

function workspaceKey(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "");
  return /^[a-z]:\//i.test(normalized)
    ? normalized.toLocaleLowerCase()
    : normalized;
}

function projectName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) || path;
}

function sameWorkspace(left: string, right: string): boolean {
  return workspaceKey(left) === workspaceKey(right);
}
