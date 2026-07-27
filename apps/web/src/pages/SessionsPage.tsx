import { Activity, MessageSquarePlus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { SessionRecord } from "@pi-web/protocol";
import { api, formatDate, formatNumber, isAbortError } from "../api";
import {
  Button,
  EmptyState,
  ErrorBanner,
  Loading,
  StatusDot
} from "../components";
import { Link, useNavigate } from "../router";
import { useUnreadSessions } from "../useUnreadSessions";
import { t } from "../i18n";
import { ui } from "../ui";

export function SessionsPage() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<SessionRecord[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [query, setQuery] = useState("");
  const unreadSessions = useUnreadSessions();

  useEffect(() => {
    const controller = new AbortController();
    api<SessionRecord[]>("/api/sessions", { signal: controller.signal })
      .then(setSessions)
      .catch((reason) => {
        if (!isAbortError(reason)) setError(reason);
      });
    return () => controller.abort();
  }, []);

  const filtered = useMemo(() => {
    if (!sessions) return [];
    const needle = query.toLowerCase();
    return sessions.filter(
      (session) =>
        session.displayName.toLowerCase().includes(needle) ||
        session.cwd.toLowerCase().includes(needle)
    );
  }, [query, sessions]);

  if (error) return <ErrorBanner error={error} />;
  if (!sessions) return <Loading label={t("读取会话")} />;

  return (
    <>
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
        <label className={ui("search-box")}>
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("搜索名称或工作目录")}
          />
        </label>
        <span className={ui("count-label")}>{t("{{count}} 个会话", { count: filtered.length })}</span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Activity size={25} />}
          title={query ? t("没有匹配的会话") : t("开始第一个会话")}
          action={
            !query && (
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
    </>
  );
}
