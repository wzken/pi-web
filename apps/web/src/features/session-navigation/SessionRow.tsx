import { Check, FolderInput, Pencil, Trash2 } from "lucide-react";
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import type { SessionFolderState, SessionRecord } from "@pi-web/protocol";
import { ActionMenu, ActionMenuItem } from "../../components";
import { formatRelativeTime, t } from "../../i18n";
import { Link } from "../../router";
import { ui } from "../../ui";

export function SessionRow({
  session,
  currentId,
  folders,
  onAssign,
  onRename,
  onDelete,
  onOpenContext,
  unread
}: {
  session: SessionRecord;
  currentId?: string | undefined;
  folders: SessionFolderState | null;
  onAssign: (sessionId: string, folderId: string | null) => Promise<void>;
  onRename: (session: SessionRecord) => void;
  onDelete: (session: SessionRecord) => void;
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
          <ActionMenuItem danger onClick={() => onDelete(session)}>
            <Trash2 size={13} />
            {t("删除")}
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
