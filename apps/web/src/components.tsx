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
  useMemo,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ChangeEvent,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PropsWithChildren,
  type Ref,
  type ReactNode
} from "react";
import type { Dialog as MduiDialogElement } from "mdui/components/dialog.js";
import type { Dropdown as MduiDropdownElement } from "mdui/components/dropdown.js";
import type { MenuItem as MduiMenuItemElement } from "mdui/components/menu-item.js";
import type { Switch as MduiSwitchElement } from "mdui/components/switch.js";
import { t } from "./i18n";
import { localizedErrorMessage } from "./api";
import { useMduiEvent } from "./mdui/events";
import mduiStyles from "./mdui/mdui-bridge.module.css";
import { Link } from "./router";
import { ui } from "./ui";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "toolbar" | "danger" | "link";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

const legacyButtonClassName = "button";
const legacyButtonVariantClassNames: Record<ButtonVariant, string> = {
  primary: "button-primary",
  secondary: "button-secondary",
  outline: "button-outline",
  ghost: "button-ghost",
  toolbar: "button-toolbar",
  danger: "button-danger",
  link: "button-link"
};
const legacyButtonSizeClassNames: Record<ButtonSize, string> = {
  sm: "button-sm",
  md: "button-md",
  lg: "button-lg",
  icon: "button-icon"
};
const legacyButtonFullClassName = "button-full";
const legacyButtonIconClassName = "button-icon";
const legacyIconButtonClassName = "icon-button";
const legacyDialogClassName = "dialog";
const legacyActiveClassName = "is-active";

type MduiButtonHostProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant: "filled" | "tonal" | "outlined" | "text";
  "full-width": boolean;
  loading: boolean;
};

type MduiButtonIconHostProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant: "standard" | "filled" | "tonal" | "outlined";
};

type MduiSwitchHostProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "role" | "aria-checked"
> & {
  ref?: Ref<MduiSwitchElement>;
  role?: "switch";
  checked: boolean;
};

type MduiMenuItemHostProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  ref?: Ref<MduiMenuItemElement>;
  selected?: boolean;
};

// The MDUI JSX declarations model generic HTMLElement event handlers. These
// host aliases retain the existing public React button contracts while the
// runtime value remains the corresponding custom-element tag.
const MduiButtonHost = "mdui-button" as unknown as (
  props: MduiButtonHostProps
) => ReactNode;
const MduiButtonIconHost = "mdui-button-icon" as unknown as (
  props: MduiButtonIconHostProps
) => ReactNode;
const MduiSwitchHost = "mdui-switch" as unknown as (
  props: MduiSwitchHostProps
) => ReactNode;
const MduiMenuItemHost = "mdui-menu-item" as unknown as (
  props: MduiMenuItemHostProps
) => ReactNode;

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

function joinClassNames(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(" ");
}

function customElementProps<T extends object>(props: T): T {
  return Object.fromEntries(
    Object.entries(props).map(([key, value]) => [
      key,
      (key.startsWith("aria-") || key.startsWith("data-")) &&
        typeof value === "boolean"
        ? String(value)
        : value
    ])
  ) as T;
}

function buttonVariant(
  variant: ButtonVariant,
  active: boolean | undefined
): "filled" | "tonal" | "outlined" | "text" {
  if (variant === "primary") return "filled";
  if (variant === "secondary" || variant === "danger") return "tonal";
  if (variant === "outline") return "outlined";
  if (variant === "toolbar" && active) return "tonal";
  return "text";
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
  tooltip?: string;
}) {
  const hasExplicitLabel = ariaLabel !== undefined;
  const control = (
    <MduiButtonHost
      {...customElementProps(props)}
      className={ui(
        joinClassNames(
          mduiStyles.button,
          legacyButtonClassName,
          legacyButtonVariantClassNames[variant],
          legacyButtonSizeClassNames[size],
          fullWidth ? legacyButtonFullClassName : undefined,
          active ? legacyActiveClassName : undefined,
          className
        )
      )}
      variant={buttonVariant(variant, active)}
      full-width={fullWidth}
      loading={loading}
      type={props.type ?? "submit"}
      disabled={disabled || loading}
      aria-busy={loading ? "true" : undefined}
      aria-pressed={active === undefined ? undefined : active ? "true" : "false"}
      data-loading={loading ? "true" : undefined}
      data-active={active ? "true" : undefined}
      data-app-variant={variant}
      data-app-size={size}
      data-app-full-width={String(fullWidth)}
      style={style as CSSProperties}
    >
      {loading ? (
        <>
          <span hidden aria-hidden="true">{leftIcon}{children}{rightIcon}</span>
          <span
            className={mduiStyles.buttonLoading}
            role="status"
            aria-hidden={hasExplicitLabel ? "true" : undefined}
          >
            {loadingLabel}
          </span>
          {hasExplicitLabel && (
            <span className={mduiStyles.visuallyHidden}>{ariaLabel}</span>
          )}
        </>
      ) : (
        <>
          {leftIcon && <span slot="icon" aria-hidden="true">{leftIcon}</span>}
          <span
            className={ui(mduiStyles.buttonContent, "button-content")}
            aria-hidden={hasExplicitLabel ? "true" : undefined}
          >
            {children}
          </span>
          {rightIcon && <span slot="end-icon" aria-hidden="true">{rightIcon}</span>}
          {hasExplicitLabel && (
            <span className={mduiStyles.visuallyHidden}>{ariaLabel}</span>
          )}
        </>
      )}
    </MduiButtonHost>
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
    <span className={ui(mduiStyles.tooltip, "tooltip")} slot={slot}>
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
  const dialogRef = useRef<MduiDialogElement>(null);
  useMduiEvent(dialogRef, "close", (event) => {
    const dialog = dialogRef.current;
    // MDUI mutates its own `open` property before emitting this cancelable
    // event. Keep the custom element open synchronously and let the owning
    // React state decide whether the controlled dialog is unmounted.
    event.preventDefault();
    onClose();
    if (dialogRef.current === dialog && dialog && !dialog.open) {
      dialog.open = true;
    }
  });

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusFrame = window.requestAnimationFrame(() => {
      dialogRef.current
        ?.querySelector<HTMLElement>(
          "[autofocus], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled), mdui-button:not([disabled]), mdui-button-icon:not([disabled]), mdui-switch:not([disabled]), [href]"
        )
        ?.focus({ preventScroll: true });
    });
    return () => {
      window.cancelAnimationFrame(focusFrame);
      previous?.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <mdui-dialog
      ref={dialogRef}
      className={mduiStyles.dialog}
      open
      close-on-esc
      close-on-overlay-click
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      style={
        maxWidth === undefined
          ? undefined
          : ({
              "--app-dialog-max-width":
                typeof maxWidth === "number" ? `${maxWidth}px` : maxWidth
            } as CSSProperties)
      }
    >
      <div
        className={joinClassNames(legacyDialogClassName, className)}
        style={{ boxSizing: "border-box", width: "100%", maxWidth: "100%" }}
      >
        {children}
      </div>
    </mdui-dialog>
  );
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
  tooltip?: string;
  variant?: Extract<ButtonVariant, "secondary" | "outline" | "ghost" | "toolbar" | "danger">;
  size?: Extract<ButtonSize, "sm" | "md" | "icon">;
  active?: boolean | undefined;
}) {
  const control = (
    <MduiButtonIconHost
      {...customElementProps(props)}
      className={ui(
        joinClassNames(
          mduiStyles.iconButton,
          legacyButtonClassName,
          legacyButtonVariantClassNames[variant],
          legacyButtonSizeClassNames[size],
          legacyButtonIconClassName,
          legacyIconButtonClassName,
          active ? legacyActiveClassName : undefined,
          className
        )
      )}
      variant={
        variant === "secondary" || variant === "toolbar" && active
          ? "tonal"
          : variant === "outline"
            ? "outlined"
            : variant === "danger"
              ? "filled"
              : "standard"
      }
      type={props.type ?? "button"}
      disabled={disabled}
      aria-pressed={active === undefined ? undefined : active ? "true" : "false"}
      data-active={active ? "true" : undefined}
      data-app-variant={variant}
      data-app-size={size}
      style={style as CSSProperties}
    >
      {children}
      <span className={mduiStyles.visuallyHidden}>{label}</span>
    </MduiButtonIconHost>
  );
  return <Tooltip content={tooltip} slot={slot}>{control}</Tooltip>;
}

export function LoadingSpinner({ size = 18 }: { size?: number }) {
  return (
    <mdui-circular-progress
      className={mduiStyles.progress}
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
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "role" | "aria-checked"> & {
  label: string;
  checked: boolean;
  loading?: boolean;
}) {
  const switchRef = useRef<MduiSwitchElement>(null);
  const { onChange, onClick, disabled, ...switchProps } = props;

  useMduiEvent(switchRef, "change", (event) => {
    if (switchRef.current) switchRef.current.checked = checked;
    onChange?.(event as unknown as ChangeEvent<HTMLButtonElement>);
    // Do not attach React's onClick to the custom-element host: the composed
    // shadow click can be observed twice by React. Preserve the existing
    // Switch API by notifying legacy onClick consumers once from MDUI change.
    onClick?.(event as unknown as ReactMouseEvent<HTMLButtonElement>);
  });

  return (
    <MduiSwitchHost
      {...customElementProps(switchProps)}
      ref={switchRef}
      role="switch"
      aria-label={label}
      aria-checked={String(checked)}
      aria-busy={loading ? "true" : undefined}
      checked={checked}
      disabled={disabled || loading}
      className={joinClassNames(mduiStyles.switch, className)}
      data-loading={loading ? "true" : undefined}
    >
      {loading && (
        <>
          <span slot="checked-icon"><LoadingSpinner size={10} /></span>
          <span slot="unchecked-icon"><LoadingSpinner size={10} /></span>
        </>
      )}
    </MduiSwitchHost>
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
  const dropdownRef = useRef<MduiDropdownElement>(null);
  useMduiEvent(dropdownRef, "open", () => setOpen(true));
  useMduiEvent(dropdownRef, "close", () => setOpen(false));
  useMduiEvent(dropdownRef, "closed", () => {
    window.requestAnimationFrame(() => {
      const dropdown = dropdownRef.current;
      if (!dropdown) return;
      const activeElement = document.activeElement;
      // A menu action may intentionally move focus into a newly opened
      // surface. Restore it only when it was left inside the now-hidden menu
      // (or nowhere), which covers pointer selection without stealing focus.
      if (
        activeElement &&
        activeElement !== document.body &&
        activeElement !== document.documentElement &&
        !dropdown.contains(activeElement)
      ) {
        return;
      }
      dropdown
        .querySelector<HTMLElement>("mdui-button-icon")
        ?.focus({ preventScroll: true });
    });
  });

  return (
    <div className={ui(`action-menu action-menu-${align}`)}>
      <mdui-dropdown
        ref={dropdownRef}
        className={mduiStyles.dropdown}
        trigger="click"
        placement={align === "end" ? "bottom-end" : "bottom-start"}
        open={open}
        data-align={align}
      >
        <IconButton
          slot="trigger"
          label={label}
          size="sm"
          active={open}
          aria-expanded={open ? "true" : "false"}
          aria-haspopup="menu"
          aria-pressed={undefined}
        >
          <MoreHorizontal size={15} />
        </IconButton>
        <mdui-menu className={mduiStyles.menu} role="menu" dense>
          {children}
        </mdui-menu>
      </mdui-dropdown>
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
  const { disabled, type: _type, ...menuItemProps } = props;
  const menuItemRef = useRef<MduiMenuItemElement>(null);

  useEffect(() => {
    if (menuItemRef.current) {
      (menuItemRef.current as unknown as { selected: boolean }).selected = active;
    }
  }, [active]);

  return (
    <MduiMenuItemHost
      {...customElementProps(menuItemProps)}
      ref={menuItemRef}
      disabled={Boolean(disabled)}
      selected={active}
      role="menuitem"
      className={joinClassNames(mduiStyles.menuItem, className)}
      data-danger={danger ? "true" : undefined}
      data-active={active ? "true" : undefined}
    >
      {children}
    </MduiMenuItemHost>
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
