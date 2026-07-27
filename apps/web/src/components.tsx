import {
  AlertTriangle,
  Check,
  LoaderCircle,
  MoreHorizontal,
  X
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type AnchorHTMLAttributes,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PropsWithChildren,
  type ReactNode
} from "react";
import { t } from "./i18n";
import { localizedErrorMessage } from "./api";
import { Link } from "./router";
import { ui } from "./ui";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "toolbar" | "danger" | "link";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

function controlClassName({
  variant,
  size,
  fullWidth,
  active,
  className
}: {
  variant: ButtonVariant;
  size: ButtonSize;
  fullWidth?: boolean;
  active?: boolean | undefined;
  className?: string;
}) {
  return `button button-${variant} button-${size}${fullWidth ? " button-full" : ""}${active ? " is-active" : ""} ${className ?? ""}`;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  loadingLabel = t("处理中…"),
  fullWidth = false,
  leftIcon,
  rightIcon,
  active,
  tooltip,
  className = "",
  children,
  disabled,
  style,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  loadingLabel?: string;
  fullWidth?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  active?: boolean | undefined;
  tooltip?: string;
}) {
  const control = (
    <button
      className={ui(controlClassName({ variant, size, fullWidth, active, className }))}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-pressed={active === undefined ? undefined : active}
      data-loading={loading || undefined}
      data-active={active || undefined}
      style={style as CSSProperties}
      {...props}
    >
      <span className={ui("button-content")}>{leftIcon}{children}{rightIcon}</span>
      {loading && (
        <span className={ui("button-loading")} aria-hidden="true">
          <LoadingSpinner size={15} /><span>{loadingLabel}</span>
        </span>
      )}
    </button>
  );
  return tooltip ? <Tooltip content={tooltip}>{control}</Tooltip> : control;
}

export function ButtonLink({
  to,
  variant = "secondary",
  size = "md",
  fullWidth = false,
  active,
  tooltip,
  leftIcon,
  rightIcon,
  className = "",
  children,
  ...props
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  to: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  active?: boolean | undefined;
  tooltip?: string;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}) {
  const control = (
    <Link
      {...props}
      to={to}
      className={ui(controlClassName({ variant, size, fullWidth, active, className }))}
      aria-current={active ? "page" : undefined}
      data-active={active || undefined}
    >
      <span className={ui("button-content")}>{leftIcon}{children}{rightIcon}</span>
    </Link>
  );
  return tooltip ? <Tooltip content={tooltip}>{control}</Tooltip> : control;
}

export function Tooltip({ content, children }: { content: string; children: ReactNode }) {
  return (
    <span className={ui("tooltip")}>
      {children}
      <span className={ui("tooltip-content")} role="tooltip">{content}</span>
    </span>
  );
}

export function Dialog({
  open,
  labelledBy,
  onClose,
  className = "",
  children
}: {
  open: boolean;
  labelledBy: string;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog
      ?.querySelector<HTMLElement>(
        "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href]"
      )
      ?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
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
  }, [open]);

  if (!open) return null;
  return (
    <div
      className={ui("dialog-backdrop")}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={ui(`dialog ${className}`)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
      >
        {children}
      </div>
    </div>
  );
}

export function IconButton({
  label,
  tooltip = label,
  variant = "ghost",
  size = "icon",
  active,
  children,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & {
  label: string;
  tooltip?: string;
  variant?: Extract<ButtonVariant, "secondary" | "outline" | "ghost" | "toolbar" | "danger">;
  size?: Extract<ButtonSize, "sm" | "md" | "icon">;
  active?: boolean | undefined;
}) {
  return (
    <Tooltip content={tooltip}>
      <Button {...props} aria-label={label} variant={variant} size={size} active={active}>{children}</Button>
    </Tooltip>
  );
}

export function LoadingSpinner({ size = 18 }: { size?: number }) {
  return <LoaderCircle size={size} className={ui("spin")} aria-hidden="true" />;
}

export function Switch({
  label,
  checked,
  loading = false,
  className = "",
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "role" | "aria-checked"> & {
  label: string;
  checked: boolean;
  loading?: boolean;
}) {
  return (
    <button
      {...props}
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      aria-busy={loading || undefined}
      disabled={props.disabled || loading}
      className={ui(`switch${checked ? " is-checked" : ""} ${className}`)}
    >
      <span className={ui("switch-thumb")}>
        {loading && <LoadingSpinner size={10} />}
      </span>
    </button>
  );
}

export function ActionMenu({
  label,
  children,
  align = "end"
}: {
  label: string;
  children: ReactNode;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menuRef.current
      ?.querySelector<HTMLButtonElement>(".action-menu-popover button:not(:disabled)")
      ?.focus();
    function closeOnOutside(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        menuRef.current?.querySelector<HTMLButtonElement>(".tooltip > button")?.focus();
      }
    }
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function closeOnBlur(event: ReactFocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setOpen(false);
    }
  }

  function moveMenuFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        ".action-menu-item:not(:disabled)"
      )
    );
    if (items.length === 0) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowDown"
            ? (currentIndex + 1) % items.length
            : (currentIndex <= 0 ? items.length : currentIndex) - 1;
    items[nextIndex]?.focus();
  }

  return (
    <div
      className={ui(`action-menu action-menu-${align}`)}
      ref={menuRef}
      onBlur={closeOnBlur}
    >
      <IconButton
        label={label}
        size="sm"
        active={open}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-pressed={undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal size={15} />
      </IconButton>
      {open && (
        <div
          className={ui("action-menu-popover")}
          role="menu"
          tabIndex={-1}
          onClick={() => setOpen(false)}
          onKeyDown={moveMenuFocus}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function ActionMenuItem({
  danger = false,
  active = false,
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  danger?: boolean;
  active?: boolean;
}) {
  return (
    <button
      {...props}
      type="button"
      role="menuitem"
      className={ui(`action-menu-item${danger ? " is-danger" : ""}${active ? " is-active" : ""} ${className}`)}
    >
      {children}
    </button>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={ui("empty-state")}>
      <div className={ui("empty-icon")}>{icon}</div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}

export function Loading({ label = t("正在加载") }: { label?: string }) {
  return (
    <div className={ui("loading")} role="status">
      <LoadingSpinner />
      <span>{label}</span>
    </div>
  );
}

export function StatusDot({ status }: { status: string }) {
  return (
    <span className={ui(`status-pill status-${status}`)}>
      <span className={ui("status-dot")} />
      {statusLabel(status)}
    </span>
  );
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    starting: t("启动中"),
    running: t("运行中"),
    waiting: t("等待指令"),
    stopping: t("停止中"),
    failed: t("失败"),
    interrupted: t("已中断"),
    closed: t("已关闭"),
    scheduled: t("已计划"),
    succeeded: t("成功"),
    timed_out: t("超时"),
    skipped_overlap: t("跳过重叠"),
    cancelled: t("已取消"),
    missed: t("已错过")
  };
  return labels[status] ?? status;
}

interface Toast {
  id: number;
  tone: "success" | "error";
  message: string;
}

const ToastContext = createContext<{
  push: (message: string, tone?: Toast["tone"]) => void;
} | null>(null);

export function ToastProvider({ children }: PropsWithChildren) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, tone: Toast["tone"] = "success") => {
    const id = Date.now() + Math.random();
    setToasts((items) => [...items, { id, tone, message }]);
    window.setTimeout(
      () => setToasts((items) => items.filter((item) => item.id !== id)),
      4200
    );
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={ui("toast-stack")} aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={ui(`toast toast-${toast.tone}`)}>
            {toast.tone === "success" ? <Check size={16} /> : <AlertTriangle size={16} />}
            <span>{toast.message}</span>
            <IconButton
              label={t("关闭通知")}
              size="sm"
              onClick={() =>
                setToasts((items) => items.filter((item) => item.id !== toast.id))
              }
            >
              <X size={14} />
            </IconButton>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be used inside ToastProvider");
  return value;
}

export function ErrorBanner({
  error,
  onDismiss
}: {
  error: unknown;
  onDismiss?: () => void;
}) {
  const message = localizedErrorMessage(error);
  return (
    <div className={ui("error-banner")} role="alert">
      <AlertTriangle size={18} />
      <span>{message}</span>
      {onDismiss && (
        <IconButton label={t("关闭错误提示")} size="sm" onClick={onDismiss}>
          <X size={16} />
        </IconButton>
      )}
    </div>
  );
}
