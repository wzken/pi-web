import {
  Check,
  ChevronDown,
  ChevronRight,
  Command,
  Folder,
  FolderInput,
  FolderPlus,
  MessageSquarePlus,
  PanelLeftClose,
  Pencil,
  Settings,
  Trash2,
  X
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
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
import { Link } from "./router";
import { useUnreadSessions } from "./useUnreadSessions";
import { ui } from "./ui";

const railStorageKey = "pi-web:session-rail-open";

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
    rail
      ?.querySelector<HTMLElement>(".workbench-rail-close")
      ?.focus();
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
      document.removeEventListener("keydown", handleKeyDown);
      previous?.focus();
    };
  }, [open, setOpen]);

  return [open, setOpen];
}

export function SessionNavigator({
  sessions,
  currentId,
  cwd,
  onClose,
  onSessionRenamed
}: {
  sessions: SessionRecord[];
  currentId?: string | undefined;
  cwd?: string;
  onClose?: () => void;
  onSessionRenamed?: (session: SessionRecord) => void;
}) {
  const workspaceSessions = useMemo(
    () =>
      cwd
        ? sessions.filter((session) => sameWorkspace(session.cwd, cwd))
        : sessions,
    [cwd, sessions]
  );
  const workspaceHome = cwd ? `/?cwd=${encodeURIComponent(cwd)}` : "/";

  return (
    <aside className={ui("workbench-session-rail")}>
      <header className={ui("workbench-rail-brand")}>
        <Link to={workspaceHome} aria-label={t("Pi Agent Web 首页")}>
          <Command size={16} />
          <strong>{t("任务")}</strong>
        </Link>
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
              <PanelLeftClose size={17} />
            </IconButton>
          )}
        </div>
      </header>

      <div className={ui("workbench-rail-path")} title={cwd}>
        {cwd ? compactPath(cwd) : t("选择工作目录后开始")}
      </div>

      <SessionGroups
        sessions={workspaceSessions}
        currentId={currentId}
        onSessionRenamed={onSessionRenamed}
      />

      <footer className={ui("workbench-rail-footer")}>
        <ButtonLink
          to="/settings"
          variant="ghost"
          size="sm"
          aria-label={t("设置")}
          title={t("设置")}
        >
          <Settings size={16} />
          <span>{t("设置")}</span>
        </ButtonLink>
      </footer>
    </aside>
  );
}

function SessionGroups({
  sessions,
  currentId,
  onSessionRenamed
}: {
  sessions: SessionRecord[];
  currentId?: string | undefined;
  onSessionRenamed: ((session: SessionRecord) => void) | undefined;
}) {
  const [folders, setFolders] = useState<SessionFolderState | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [renamedSessions, setRenamedSessions] = useState<
    Record<string, SessionRecord>
  >({});
  const [renaming, setRenaming] = useState<SessionRecord | null>(null);
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
    () => sessions.map((session) => renamedSessions[session.id] ?? session),
    [renamedSessions, sessions]
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
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section className={ui("session-groups")}>
      <div className={ui("session-groups-heading")}>
        <span>{t("会话")}</span>
        <IconButton
          label={t("创建对话文件夹")}
          size="sm"
          onClick={() => setCreating(true)}
        >
          <FolderPlus size={14} />
        </IconButton>
      </div>

      <div className={ui("session-groups-feedback")}>
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
      </div>

      <div className={ui("session-group-list")}>
        {folders?.folders.map((folder) => {
          const items = grouped.byFolder.get(folder.id) ?? [];
          const isCollapsed = collapsed.has(folder.id);
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
                unread={unreadSessions.has(session.id)}
              />
            ))}
          </section>
        )}

        {sessions.length === 0 && (
          <p className={ui("session-groups-empty")}>
            {t("第一条任务会自动建立并启动 Pi 会话。")}
          </p>
        )}
      </div>

      <Link className={ui("session-groups-more")} to="/sessions">
        {t("查看全部会话")}
      </Link>

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
  unread
}: {
  session: SessionRecord;
  currentId?: string | undefined;
  folders: SessionFolderState | null;
  onAssign: (sessionId: string, folderId: string | null) => Promise<void>;
  onRename: (session: SessionRecord) => void;
  unread: boolean;
}) {
  const folderId = folders?.assignments[session.id] ?? "";
  return (
    <div
      className={ui(`session-nav-row${session.id === currentId ? " is-active" : ""}${
        unread ? " is-unread" : ""
      }`)}
    >
      <Link
        to={`/sessions/${session.id}`}
        aria-label={`${session.displayName}${unread ? t("，有未读通知") : ""}`}
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

function compactPath(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  if (segments.length <= 2) return path;
  return `…/${segments.slice(-2).join("/")}`;
}

function sameWorkspace(left: string, right: string): boolean {
  const normalize = (value: string) => {
    const normalized = value.replaceAll("\\", "/").replace(/\/+$/, "");
    return /^[a-z]:\//i.test(normalized)
      ? normalized.toLocaleLowerCase()
      : normalized;
  };
  return normalize(left) === normalize(right);
}
