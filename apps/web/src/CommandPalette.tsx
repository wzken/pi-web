import type { SessionRecord } from "@pi-web/protocol";
import {
  Activity,
  Bot,
  CalendarClock,
  MessageSquarePlus,
  Search,
  Settings,
  type LucideIcon
} from "lucide-react";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { api, formatDate, isAbortError } from "./api";
import { Dialog, ErrorBanner, Loading, StatusDot } from "./components";
import { useNavigate } from "./router";
import styles from "./CommandPalette.module.css";
import { t } from "./i18n";
import { ui } from "./ui";

export interface CommandPaletteItem {
  id: string;
  label: string;
  description: string;
  keywords: string;
  to: string;
  icon: LucideIcon;
  status?: SessionRecord["status"];
}

const pageCommands: CommandPaletteItem[] = [
  {
    id: "new-session",
    label: "新建会话",
    description: "选择工作目录并开始任务",
    keywords: "home start chat 首页 开始",
    to: "/",
    icon: MessageSquarePlus
  },
  {
    id: "sessions",
    label: "浏览全部会话",
    description: "查找和恢复历史会话",
    keywords: "sessions history 历史",
    to: "/sessions",
    icon: Activity
  },
  {
    id: "schedules",
    label: "打开调度",
    description: "管理计划任务",
    keywords: "schedules cron 定时 计划任务",
    to: "/schedules",
    icon: CalendarClock
  },
  {
    id: "pi",
    label: "打开 Pi 管理",
    description: "管理模型和运行时",
    keywords: "model runtime 模型 运行时",
    to: "/pi",
    icon: Bot
  },
  {
    id: "settings",
    label: "打开设置",
    description: "调整界面与系统选项",
    keywords: "settings preferences 配置 偏好",
    to: "/settings",
    icon: Settings
  }
];

export function filterCommandItems(
  items: CommandPaletteItem[],
  query: string
): CommandPaletteItem[] {
  const tokens = query
    .normalize("NFKC")
    .toLocaleLowerCase()
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
  if (tokens.length === 0) return items;
  return items.filter((item) => {
    const haystack = `${item.label} ${item.description} ${item.keywords}`
      .normalize("NFKC")
      .toLocaleLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });
}

export function CommandPalette({
  open,
  onClose
}: {
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    setError(null);
    setLoading(true);
    const controller = new AbortController();
    void api<SessionRecord[]>("/api/sessions", {
      signal: controller.signal
    })
      .then(setSessions)
      .catch((reason) => {
        if (!isAbortError(reason)) setError(reason);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open]);

  const commands = useMemo<CommandPaletteItem[]>(
    () => [
      ...pageCommands.map((item) => ({
        ...item,
        label: t(item.label),
        description: t(item.description)
      })),
      ...sessions.map((session) => ({
        id: `session-${session.id}`,
        label: session.displayName,
        description: `${session.cwd} · ${formatDate(session.updatedAt)}`,
        keywords: `session 会话 ${session.cwd} ${session.model ?? ""}`,
        to: `/sessions/${session.id}`,
        icon: Activity,
        status: session.status
      }))
    ],
    [sessions]
  );
  const filtered = useMemo(
    () => filterCommandItems(commands, query).slice(0, 20),
    [commands, query]
  );
  const selectedIndex = Math.min(activeIndex, Math.max(filtered.length - 1, 0));

  function activate(item: CommandPaletteItem | undefined) {
    if (!item) return;
    navigate(item.to);
    onClose();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) =>
        filtered.length === 0 ? 0 : (index + 1) % filtered.length
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) =>
        filtered.length === 0
          ? 0
          : (index - 1 + filtered.length) % filtered.length
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      activate(filtered[selectedIndex]);
    }
  }

  return (
    <Dialog
      open={open}
      labelledBy="command-palette-title"
      onClose={onClose}
      className={ui(styles.dialog ?? "")}
      maxWidth={680}
    >
      <h2 id="command-palette-title" className={ui(styles.title)}>
        {t("命令面板")}
      </h2>
      <label className={ui(styles.search)}>
        <Search size={18} aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={handleKeyDown}
          placeholder={t("搜索页面或最近会话…")}
          aria-label={t("搜索页面或最近会话…")}
          role="combobox"
          aria-expanded="true"
          aria-controls="command-palette-results"
          aria-activedescendant={
            filtered[selectedIndex]
              ? `command-option-${filtered[selectedIndex].id}`
              : undefined
          }
        />
        <kbd>ESC</kbd>
      </label>
      {error !== null && (
        <div className={ui(styles.error)}>
          <ErrorBanner error={error} />
        </div>
      )}
      <div
        id="command-palette-results"
        className={ui(styles.results)}
        role="listbox"
        aria-label={t("命令")}
      >
        {filtered.map((item, index) => {
          const Icon = item.icon;
          const active = index === selectedIndex;
          return (
            <button
              id={`command-option-${item.id}`}
              key={item.id}
              type="button"
              role="option"
              aria-selected={active}
              className={ui(`${styles.item}${active ? ` ${styles.active}` : ""}`)}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => activate(item)}
            >
              <span className={ui(styles.icon)}>
                <Icon size={17} aria-hidden="true" />
              </span>
              <span className={ui(styles.copy)}>
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </span>
              {item.status && <StatusDot status={item.status} />}
            </button>
          );
        })}
        {filtered.length === 0 && (
          <p className={ui(styles.empty)}>{t("没有匹配的页面或最近会话")}</p>
        )}
        {loading && (
          <div className={ui(styles.loading)}>
            <Loading label={t("读取最近会话")} />
          </div>
        )}
      </div>
      <footer className={ui(styles.footer)}>
        <span>
          <kbd>↑</kbd><kbd>↓</kbd> {t("选择")}
        </span>
        <span>
          <kbd>↵</kbd> {t("打开")}
        </span>
      </footer>
    </Dialog>
  );
}
