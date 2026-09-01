import {
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  Pencil,
  Pin,
  Trash2,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { SessionFolder, SessionFolderState, SessionRecord } from "@pi-web/protocol";
import { api, isAbortError, jsonBody } from "../../api";
import {
  ActionMenu,
  ActionMenuItem,
  Button,
  Dialog,
  IconButton,
  useToast
} from "../../components";
import { t } from "../../i18n";
import { Link } from "../../router";
import { useNotifications } from "../../notification-context";
import { ui } from "../../ui";
import { compareSidebarSessions, useSidebarSectionCollapsed } from "./session-navigation";
import { SessionRow } from "./SessionRow";

const chatPreviewLimit = 5;

export function SessionGroups({
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
  const unreadSessions = useNotifications().unreadSessionIds;

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
                    onDelete={setDeleting}
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
                onDelete={setDeleting}
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
            {t("确定永久删除会话“{{name}}”？会话记录将被删除且无法恢复。", {
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
