import {
  Activity,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  X
} from "lucide-react";
import { useMemo } from "react";
import { formatDate, formatNumber } from "../api";
import {
  Button,
  ButtonLink,
  EmptyState,
  ErrorBanner,
  IconButton,
  Loading,
  StatusDot
} from "../components";
import { Link, useNavigate, useSearchParams } from "../router";
import { useUnreadSessions } from "../useUnreadSessions";
import { t } from "../i18n";
import { ui } from "../ui";
import { useSessionList } from "../useSessionList";
import { SessionNavigator, useWorkbenchRail } from "../SessionNavigator";

export function SessionsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { sessions, setSessions, error } = useSessionList();
  const query = searchParams.get("q") ?? "";
  const unreadSessions = useUnreadSessions();
  const [railOpen, setRailOpen] = useWorkbenchRail();

  function setQuery(value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set("q", value);
    else next.delete("q");
    const search = next.toString();
    navigate(`/sessions${search ? `?${search}` : ""}`, { replace: true });
  }

  const filtered = useMemo(() => {
    if (!sessions) return [];
    const needle = query.toLowerCase();
    return sessions.filter(
      (session) =>
        session.displayName.toLowerCase().includes(needle) ||
        session.cwd.toLowerCase().includes(needle)
    );
  }, [query, sessions]);

  if (error && !sessions) return <ErrorBanner error={error} />;
  if (!sessions) return <Loading label={t("读取会话")} />;

  return (
    <div
      className={ui(
        `home-workbench sessions-workbench-page${railOpen ? "" : " rail-collapsed"}`
      )}
    >
      {railOpen && (
        <>
          <SessionNavigator
            sessions={sessions}
            onClose={() => setRailOpen(false)}
            onSessionRenamed={(updated) =>
              setSessions((current) =>
                current?.map((session) =>
                  session.id === updated.id ? updated : session
                ) ?? null
              )
            }
          />
          <button
            className={ui("workbench-rail-backdrop")}
            aria-label={t("收起会话栏")}
            onClick={() => setRailOpen(false)}
          />
        </>
      )}

      <main className={ui("sessions-workbench-main")}>
        <header className={ui("workbench-topbar")}>
          <IconButton
            className={ui("workbench-rail-toggle")}
            label={railOpen ? t("收起会话栏") : t("展开会话栏")}
            variant="toolbar"
            aria-expanded={railOpen}
            onClick={() => setRailOpen((value) => !value)}
          >
            {railOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
          </IconButton>
          <div className={ui("workbench-topbar-title")}>
            <strong>{t("会话")}</strong>
            <span>{t("全部工作区")}</span>
          </div>
          <div className={ui("workbench-topbar-actions")}>
            <Button variant="toolbar" size="sm" onClick={() => navigate("/")}>
              <MessageSquarePlus size={15} />
              <span>{t("新会话")}</span>
            </Button>
            <ButtonLink
              to="/settings"
              variant="toolbar"
              size="icon"
              aria-label={t("设置")}
              title={t("设置")}
            >
              <Settings size={16} />
            </ButtonLink>
          </div>
        </header>

        <div className={ui("sessions-workbench-content")}>
      {error !== null && <ErrorBanner error={error} />}
      <header className={ui("page-header")}>
        <div>
          <p className={ui("eyebrow")}>SESSIONS</p>
          <h1>{t("会话")}</h1>
          <p>{t("这里用于查找和恢复历史；新会话从首页发送第一条任务后创建。")}</p>
        </div>
        <Button onClick={() => navigate("/")}>
          <MessageSquarePlus size={17} />
          {t("发起新会话")}
        </Button>
      </header>

      <div className={ui("toolbar")}>
        <div className={ui("search-box")} role="search">
          <Search size={17} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("搜索名称或工作目录")}
            aria-label={t("搜索名称或工作目录")}
          />
          {query && (
            <IconButton
              label={t("清除搜索")}
              size="sm"
              onClick={() => setQuery("")}
            >
              <X size={14} />
            </IconButton>
          )}
        </div>
        <span className={ui("count-label")}>{t("{{count}} 个会话", { count: filtered.length })}</span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Activity size={25} />}
          title={query ? t("没有匹配的会话") : t("开始第一个会话")}
          action={
            query ? (
              <Button variant="secondary" onClick={() => setQuery("")}>
                {t("清除搜索")}
              </Button>
            ) : (
              <Button onClick={() => navigate("/")}>
                {t("输入第一条任务")}
              </Button>
            )
          }
        >
          {query
            ? t("换一个关键词试试。")
            : t("选择工作目录并发送任务，Pi 会自动创建会话并在后台持续运行。")}
        </EmptyState>
      ) : (
        <div className={ui("session-card-grid")}>
          {filtered.map((session) => (
            <Link className={ui("session-card")} to={`/sessions/${session.id}`} key={session.id}>
              <div className={ui("session-card-top")}>
                <div className={ui("row-avatar large")}>
                  {session.displayName.slice(0, 1).toUpperCase()}
                </div>
                <StatusDot status={session.status} />
                {unreadSessions.has(session.id) && (
                  <span className={ui("session-unread-label")}>{t("未读")}</span>
                )}
              </div>
              <h2>{session.displayName}</h2>
              <p title={session.cwd}>{session.cwd}</p>
              <div className={ui("session-card-stats")}>
                <span>
                  <b>{formatNumber(session.inputTokens + session.outputTokens)}</b>
                  Token
                </span>
                <span>
                  <b>{session.toolCalls}</b>
                  {t("工具调用")}
                </span>
                <span>
                  <b>{session.model?.split("/").at(-1) ?? t("默认")}</b>
                  {t("模型")}
                </span>
              </div>
              <div className={ui("session-card-foot")}>
                <span>{session.createdBy === "cron" ? "Cron" : t("交互")}</span>
                <time>{formatDate(session.updatedAt)}</time>
              </div>
            </Link>
          ))}
        </div>
      )}
        </div>
      </main>
    </div>
  );
}
