import {
  Activity,
  ChevronRight,
  LogOut,
  Settings,
  UserRound
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "./auth";
import { useLocation, useNavigate } from "./router";
import { t } from "./i18n";
import styles from "./AccountMenu.module.css";

export function AccountMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { logout } = useAuth();

  useEffect(() => setOpen(false), [location.pathname]);

  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const focusFrame = window.requestAnimationFrame(() => {
      root?.querySelector<HTMLElement>("[role='menuitem']")?.focus();
    });

    function handlePointerDown(event: PointerEvent) {
      if (!root?.contains(event.target as Node)) setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key === "Tab") {
        setOpen(false);
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        return;
      }
      const items = Array.from(
        root?.querySelectorAll<HTMLElement>("[role='menuitem']:not(:disabled)") ?? []
      );
      if (items.length === 0) return;
      event.preventDefault();
      const current = items.indexOf(document.activeElement as HTMLElement);
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : event.key === "ArrowUp"
              ? (current - 1 + items.length) % items.length
              : (current + 1) % items.length;
      items[next]?.focus();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus({ preventScroll: true });
    };
  }, [open]);

  function go(to: string) {
    setOpen(false);
    navigate(to);
  }

  return (
    <div ref={rootRef} className={styles.root}>
      {open && (
        <div className={styles.menu} role="menu" aria-label={t("账户菜单")}>
          <div className={styles.identity}>
            <span className={styles.avatar} aria-hidden="true">
              <UserRound size={17} />
            </span>
            <span>
              <strong>{t("管理员")}</strong>
              <small>{t("本地运行")}</small>
            </span>
          </div>
          <div className={styles.separator} />
          <button type="button" role="menuitem" onClick={() => go("/settings")}>
            <Settings size={17} />
            <span>{t("设置")}</span>
            <ChevronRight className={styles.chevron} size={15} />
          </button>
          <button type="button" role="menuitem" onClick={() => go("/pi")}>
            <Activity size={17} />
            <span>{t("运行状态")}</span>
            <ChevronRight className={styles.chevron} size={15} />
          </button>
          <div className={styles.separator} />
          <button
            type="button"
            role="menuitem"
            className={styles.danger}
            onClick={() => {
              setOpen(false);
              void logout();
            }}
          >
            <LogOut size={17} />
            <span>{t("退出登录")}</span>
            <ChevronRight className={styles.chevron} size={15} />
          </button>
        </div>
      )}

      <button
        type="button"
        className={styles.trigger}
        aria-label={t("打开账户菜单")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.avatar} aria-hidden="true">
          <UserRound size={17} />
        </span>
        <span className={styles.triggerCopy}>
          <strong>{t("管理员")}</strong>
          <small>{t("本地运行")}</small>
        </span>
        <ChevronRight className={styles.triggerChevron} size={15} />
      </button>
    </div>
  );
}
