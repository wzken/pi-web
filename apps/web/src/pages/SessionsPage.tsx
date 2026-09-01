import {
  Activity,
  Pin,
  Search,
  X
} from "lucide-react";
import { useMemo } from "react";
import { formatDate, formatNumber } from "../api";
import {
  Button,
  EmptyState,
  ErrorBanner,
  IconButton,
  Loading,
  StatusDot
} from "../components";
import { Link, useNavigate, useSearchParams } from "../router";
import { useNotifications } from "../notification-context";
import {
  parseSessionSortOrder,
  parseSessionViewFilter,
  projectSessions,
  type SessionSortOrder,
  type SessionViewFilter
} from "../session-list-projection";
import { t } from "../i18n";
import { ui } from "../ui";
import { useSessionList } from "../useSessionList";

const sessionFilters: Array<{
  value: SessionViewFilter;
  label: string;
}> = [
  { value: "all", label: "全部" },
  { value: "active", label: "活动中" },
  { value: "attention", label: "需处理" },
  { value: "pinned", label: "已固定" },
  { value: "closed", label: "已结束" }
];

export function SessionsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { sessions, error } = useSessionList();
  const query = searchParams.get("q") ?? "";
  const filter = parseSessionViewFilter(searchParams.get("filter"));
  const sort = parseSessionSortOrder(searchParams.get("sort"));
  const unreadSessions = useNotifications().unreadSessionIds;

  function updateView(
    update: {
      q?: string;
      filter?: SessionViewFilter;
      sort?: SessionSortOrder;
    },
    replace = false
  ) {
    const next = new URLSearchParams(searchParams);
    if (update.q !== undefined) {
      if (update.q.trim()) next.set("q", update.q);
      else next.delete("q");
    }
    if (update.filter !== undefined) {
      if (update.filter === "all") next.delete("filter");
      else next.set("filter", update.filter);
    }
    if (update.sort !== undefined) {
      if (update.sort === "recent") next.delete("sort");
      else next.set("sort", update.sort);
    }
    const search = next.toString();
    navigate(`/sessions${search ? `?${search}` : ""}`, { replace });
  }

  function resetView() {
    navigate("/sessions");
  }

  const filtered = useMemo(
    () =>
      projectSessions(sessions ?? [], {
        query,
        filter,
        sort
      }),
    [filter, query, sessions, sort]
  );

  if (error && !sessions) return <ErrorBanner error={error} />;
  if (!sessions) return <Loading label={t("读取会话")} />;

  const activeCount = sessions.filter((session) =>
    ["starting", "running", "waiting", "stopping"].includes(session.status)
  ).length;
  const totalTokens = sessions.reduce(
    (sum, session) => sum + session.inputTokens + session.outputTokens,
    0
  );
  const projectCount = new Set(sessions.map((session) => session.cwd)).size;

  return (
    <section className={ui("redesign-page sessions-redesign-page sessions-workbench-content")}>
      <header className={ui("redesign-page-heading")}>
        <div>
          <p className={ui("redesign-kicker")}>WORK HISTORY</p>
          <h1>{t("会话")}</h1>
          <p>{t("这里用于查找和恢复历史；新会话从首页发送第一条任务后创建。")}</p>
        </div>
      </header>

      {error !== null && <ErrorBanner error={error} />}

      <section className={ui("redesign-metric-strip")} aria-label={t("会话")}>
        <article>
          <span>{t("全部会话")}</span>
          <strong>{sessions.length}</strong>
          <small>{t("持久保存在 Pi JSONL")}</small>
        </article>
        <article>
          <span>{t("活动会话")}</span>
          <strong>{activeCount}</strong>
          <small>{t("由 Session Daemon 监督")}</small>
        </article>
        <article>
          <span>{t("工作区")}</span>
          <strong>{projectCount}</strong>
          <small>{t("独立项目上下文")}</small>
        </article>
        <article>
          <span>Token</span>
          <strong>{formatNumber(totalTokens)}</strong>
          <small>{t("累计输入与输出")}</small>
        </article>
      </section>

      <div className={ui("redesign-list-toolbar")}>
        <div className={ui("redesign-session-controls")}>
          <div className={ui("redesign-search")} role="search">
            <Search size={17} aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => updateView({ q: event.target.value }, true)}
              placeholder={t("搜索名称、工作目录或模型")}
              aria-label={t("搜索名称、工作目录或模型")}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            {query ? (
              <IconButton
                label={t("清除搜索")}
                size="sm"
                onClick={() => updateView({ q: "" }, true)}
              >
                <X size={14} />
              </IconButton>
            ) : null}
          </div>
          <label className={ui("redesign-session-sort")}>
            <span>{t("排序")}</span>
            <select
              value={sort}
              onChange={(event) =>
                updateView({ sort: event.target.value as SessionSortOrder })
              }
            >
              <option value="recent">{t("最近更新")}</option>
              <option value="oldest">{t("最早更新")}</option>
              <option value="tokens">{t("Token 最多")}</option>
              <option value="tools">{t("工具调用最多")}</option>
            </select>
          </label>
        </div>
        <span>{t("{{count}} 个会话", { count: filtered.length })}</span>
      </div>

      <div
        className={ui("redesign-session-filters")}
        role="group"
        aria-label={t("筛选会话")}
      >
        {sessionFilters.map((item) => (
          <button
            key={item.value}
            type="button"
            className={ui("redesign-session-filter")}
            aria-pressed={filter === item.value}
            data-active={filter === item.value ? "true" : undefined}
            onClick={() => updateView({ filter: item.value })}
          >
            {t(item.label)}
          </button>
        ))}
        {(query || filter !== "all" || sort !== "recent") && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={ui("redesign-session-reset")}
            onClick={resetView}
          >
            <X size={14} aria-hidden="true" />
            {t("重置视图")}
          </Button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className={ui("redesign-empty-panel")}>
          <EmptyState
            icon={<Activity size={25} />}
            title={
              query || filter !== "all"
                ? t("没有符合当前条件的会话")
                : t("开始第一个会话")
            }
            action={
              query || filter !== "all" || sort !== "recent" ? (
                <Button variant="secondary" onClick={resetView}>
                  {t("重置视图")}
                </Button>
              ) : (
                <Button onClick={() => navigate("/")}>
                  {t("输入第一条任务")}
                </Button>
              )
            }
          >
            {query || filter !== "all"
              ? t("调整搜索词或筛选条件后再试。")
              : t("选择工作目录并发送任务，Pi 会自动创建会话并在后台持续运行。")}
          </EmptyState>
        </div>
      ) : (
        <div className={ui("redesign-session-list")}>
          {filtered.map((session) => (
            <Link
              className={ui("redesign-session-row")}
              to={`/sessions/${encodeURIComponent(session.id)}`}
              key={session.id}
            >
              <div className={ui("redesign-session-avatar")} aria-hidden="true">
                {session.displayName.slice(0, 1).toUpperCase()}
              </div>
              <div className={ui("redesign-session-copy")}>
                <div>
                  <h2>{session.displayName}</h2>
                  {session.pinned ? (
                    <span className={ui("redesign-pinned")} title={t("已固定")}>
                      <Pin size={11} aria-hidden="true" />
                      <span>{t("已固定")}</span>
                    </span>
                  ) : null}
                  {unreadSessions.has(session.id) ? (
                    <span className={ui("redesign-unread")}>{t("未读")}</span>
                  ) : null}
                </div>
                <p title={session.cwd}>{session.cwd}</p>
              </div>
              <div className={ui("redesign-session-runtime")}>
                <StatusDot status={session.status} />
                <span>{session.model?.split("/").at(-1) ?? t("默认模型")}</span>
              </div>
              <div className={ui("redesign-session-stat")}>
                <strong>{formatNumber(session.inputTokens + session.outputTokens)}</strong>
                <span>token</span>
              </div>
              <div className={ui("redesign-session-stat")}>
                <strong>{session.toolCalls}</strong>
                <span>{t("工具调用")}</span>
              </div>
              <time dateTime={session.updatedAt}>{formatDate(session.updatedAt)}</time>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
