import {
  AlertTriangle,
  Check,
  MoreHorizontal,
  X
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type PropsWithChildren,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";
import { t } from "./i18n";
import { localizedErrorMessage } from "./api";
import styles from "./components.module.css";
import { Link } from "./router";
import { registerMobileDismiss } from "./mobile-back-stack";
import { ui } from "./ui";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "toolbar" | "danger" | "link";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

const buttonVariantClassNames: Record<ButtonVariant, string> = {
  primary: "button-primary",
  secondary: "button-secondary",
  outline: "button-outline",
  ghost: "button-ghost",
  toolbar: "button-toolbar",
  danger: "button-danger",
  link: "button-link"
};
const buttonSizeClassNames: Record<ButtonSize, string> = {
  sm: "button-sm",
  md: "button-md",
  lg: "button-lg",
  icon: "button-icon"
};

function linkControlClassName({
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
  "aria-label": ariaLabel,
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
  tooltip?: string | null;
}) {
  const hasExplicitLabel = ariaLabel !== undefined;
  const control = (
    <button
      {...props}
      className={ui(
        "button",
        buttonVariantClassNames[variant],
        buttonSizeClassNames[size],
        fullWidth && "button-full",
        active && "is-active",
        className
      )}
      type={props.type ?? "submit"}
      disabled={disabled || loading}
      aria-label={ariaLabel}
      aria-busy={loading ? "true" : undefined}
      aria-pressed={active === undefined ? undefined : active}
      data-loading={loading ? "true" : undefined}
      data-active={active ? "true" : undefined}
      data-app-variant={variant}
      data-app-size={size}
      style={style}
    >
      <span
        className={ui("button-content")}
        aria-hidden={loading || hasExplicitLabel ? "true" : undefined}
      >
        {leftIcon}
        {children}
        {rightIcon}
      </span>
      {loading && (
        <span
          className={styles.buttonLoading}
          role="status"
          aria-hidden={hasExplicitLabel ? "true" : undefined}
        >
          {loadingLabel}
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
  tooltip?: string | null;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}) {
  const control = (
    <Link
      {...props}
      to={to}
      className={ui(linkControlClassName({ variant, size, fullWidth, active, className }))}
      aria-current={active ? "page" : undefined}
      data-active={active || undefined}
    >
      <span className={ui("button-content")}>{leftIcon}{children}{rightIcon}</span>
    </Link>
  );
  return tooltip ? <Tooltip content={tooltip}>{control}</Tooltip> : control;
}

function Tooltip({
  content,
  children,
  slot
}: {
  content: string;
  children: ReactNode;
  slot?: string | undefined;
}) {
  return (
    <span className={ui("tooltip")} slot={slot}>
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
  maxWidth,
  children
}: {
  open: boolean;
  labelledBy: string;
  onClose: () => void;
  className?: string;
  maxWidth?: string | number;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    return registerMobileDismiss(onClose);
  }, [onClose, open]);

  useEffect(() => {
    if (!open) return;
    const focusFrame = window.requestAnimationFrame(() => {
      dialogRef.current
        ?.querySelector<HTMLElement>(
          "[autofocus], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled):not([tabindex='-1']), [href]"
        )
        ?.focus({ preventScroll: true });
    });
    return () => {
      window.cancelAnimationFrame(focusFrame);
      returnFocusRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;
  const dialog = (
    <dialog
      ref={dialogRef}
      className={styles.dialogHost}
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      style={
        maxWidth === undefined
          ? undefined
          : ({
              "--app-dialog-max-width":
                typeof maxWidth === "number" ? `${maxWidth}px` : maxWidth
            } as CSSProperties)
      }
    >
      <button
        type="button"
        tabIndex={-1}
        className={styles.dialogBackdrop}
        aria-label={t("关闭")}
        onClick={onClose}
      />
      <div className={ui("dialog", styles.dialogPanel, className)}>
        {children}
      </div>
    </dialog>
  );
  return typeof document === "undefined"
    ? dialog
    : createPortal(dialog, document.body);
}

export function IconButton({
  label,
  tooltip = label,
  variant = "ghost",
  size = "icon",
  active,
  children,
  className = "",
  disabled,
  style,
  slot,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & {
  label: string;
  tooltip?: string | null;
  variant?: Extract<ButtonVariant, "secondary" | "outline" | "ghost" | "toolbar" | "danger">;
  size?: Extract<ButtonSize, "sm" | "md" | "icon">;
  active?: boolean | undefined;
}) {
  const control = (
    <button
      {...props}
      className={ui(
        "button",
        buttonVariantClassNames[variant],
        buttonSizeClassNames[size],
        "button-icon",
        "icon-button",
        active && "is-active",
        className
      )}
      type={props.type ?? "button"}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      data-active={active ? "true" : undefined}
      data-app-variant={variant}
      data-app-size={size}
      style={style}
    >
      {children}
    </button>
  );
  return tooltip === null ? control : (
    <Tooltip content={tooltip} slot={slot}>{control}</Tooltip>
  );
}

export function LoadingSpinner({ size = 18 }: { size?: number }) {
  return (
    <span
      className={styles.spinner}
      aria-hidden="true"
      style={{ width: size, height: size }}
    />
  );
}

export function Switch({
  label,
  checked,
  loading = false,
  className = "",
  disabled,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "role" | "aria-checked"> & {
  label: string;
  checked: boolean;
  loading?: boolean;
}) {
  return (
    <button
      {...props}
      type={props.type ?? "button"}
      role="switch"
      aria-label={label}
      aria-checked={checked}
      aria-busy={loading ? "true" : undefined}
      disabled={disabled || loading}
      className={ui(styles.switch, "switch", className)}
      data-loading={loading ? "true" : undefined}
    >
      {loading && (
        <span className={styles.switchLoading}>
          <LoadingSpinner size={10} />
        </span>
      )}
    </button>
  );
}

const ActionMenuContext = createContext<{ close: () => void } | null>(null);

interface ActionMenuPosition {
  top?: number;
  bottom?: number;
  left: number;
  maxHeight: number;
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
  const [position, setPosition] = useState<ActionMenuPosition | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const close = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => {
      rootRef.current
        ?.querySelector<HTMLButtonElement>("button")
        ?.focus({ preventScroll: true });
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }

    const updatePosition = () => {
      const trigger = rootRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;
      const anchor = trigger.getBoundingClientRect();
      const menuBox = menu.getBoundingClientRect();
      const visualViewport = window.visualViewport;
      const viewportLeft = visualViewport?.offsetLeft ?? 0;
      const viewportTop = visualViewport?.offsetTop ?? 0;
      const viewportRight =
        viewportLeft + (visualViewport?.width ?? window.innerWidth);
      const viewportBottom =
        viewportTop + (visualViewport?.height ?? window.innerHeight);
      const margin = 8;
      const gap = 6;
      const availableBelow = viewportBottom - anchor.bottom - gap - margin;
      const availableAbove = anchor.top - viewportTop - gap - margin;
      const openBelow =
        availableBelow >= Math.min(menuBox.height, 180) ||
        availableBelow >= availableAbove;
      const maxHeight = Math.max(
        48,
        openBelow ? availableBelow : availableAbove
      );
      const visibleHeight = Math.min(menuBox.height, maxHeight);
      const preferredLeft =
        align === "end" ? anchor.right - menuBox.width : anchor.left;
      const left = Math.min(
        Math.max(preferredLeft, viewportLeft + margin),
        Math.max(viewportLeft + margin, viewportRight - menuBox.width - margin)
      );
      const verticalPosition = openBelow
        ? {
            top: Math.max(
              viewportTop + margin,
              Math.min(anchor.bottom + gap, viewportBottom - visibleHeight - margin)
            )
          }
        : {
            bottom: Math.max(
              margin,
              window.innerHeight - anchor.top + gap
            )
          };
      setPosition({ ...verticalPosition, left, maxHeight });
    };

    updatePosition();
    const frame = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.visualViewport?.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("scroll", updatePosition);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.visualViewport?.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("scroll", updatePosition);
    };
  }, [align, open]);

  useEffect(() => {
    if (!open) return;
    return registerMobileDismiss(close);
  }, [close, open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [close, open]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      menuRef.current
        ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
        ?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  const popup = open ? (
    <div
      className={ui(styles.menuPopover, "action-menu-popover")}
      style={{
        top: position?.top,
        bottom: position?.bottom,
        left: position?.left ?? 0,
        maxHeight: position?.maxHeight ?? "calc(100dvh - 16px)",
        visibility: position ? "visible" : "hidden"
      }}
    >
      <div
        ref={menuRef}
        id={menuId}
        className={ui(styles.menu, "action-menu-list")}
        role="menu"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            return;
          }
          event.preventDefault();
          const items = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)"
            )
          );
          if (items.length === 0) return;
          const current = items.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : event.key === "ArrowDown"
                ? (current + 1) % items.length
                : (current - 1 + items.length) % items.length;
          items[next]?.focus();
        }}
      >
        {children}
      </div>
    </div>
  ) : null;

  return (
    <ActionMenuContext.Provider value={{ close }}>
      <div
        ref={rootRef}
        className={ui(`action-menu action-menu-${align}`)}
      >
        <IconButton
          label={label}
          size="sm"
          active={open}
          aria-expanded={open ? "true" : "false"}
          aria-haspopup="menu"
          aria-controls={open ? menuId : undefined}
          aria-pressed={undefined}
          onClick={() => setOpen((value) => !value)}
        >
          <MoreHorizontal size={15} />
        </IconButton>
      </div>
      {popup && typeof document !== "undefined"
        ? createPortal(popup, document.body)
        : popup}
    </ActionMenuContext.Provider>
  );
}

export function ActionMenuItem({
  danger = false,
  active = false,
  children,
  className = "",
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  danger?: boolean;
  active?: boolean;
}) {
  const { disabled, type = "button", ...menuItemProps } = props;
  const menu = useContext(ActionMenuContext);

  return (
    <button
      {...menuItemProps}
      type={type}
      disabled={disabled}
      role="menuitem"
      className={ui(styles.menuItem, "action-menu-item", className)}
      data-danger={danger ? "true" : undefined}
      data-active={active ? "true" : undefined}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) menu?.close();
      }}
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
