import {
  Activity,
  ArrowRight,
  CalendarClock,
  CircleAlert,
  Coins,
  MessageSquarePlus,
  Radio,
  Sparkles
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "../router";
import type { DashboardSummary } from "@pi-web/protocol";
import {
  ErrorBanner,
  Loading,
  StatusDot
} from "../components";
import {
  api,
  formatCost,
  formatDate,
  formatNumber,
  isAbortError
} from "../api";
import { t } from "../i18n";
import { ui } from "../ui";

interface SystemInfo {
  secureConnection: boolean;
  warning: string | null;
}

export function DashboardPage() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      api<DashboardSummary>("/api/dashboard", { signal: controller.signal }),
      api<SystemInfo>("/api/system", { signal: controller.signal })
    ])
      .then(([dashboard, info]) => {
        setData(dashboard);
        setSystem(info);
      })
      .catch((reason) => {
        if (!isAbortError(reason)) setError(reason);
      });
    return () => controller.abort();
  }, []);

  if (error) return <ErrorBanner error={error} />;
  if (!data) return <Loading label={t("读取运行状态")} />;

  const metrics = [
    {
      label: t("正在运行"),
      value: String(data.runningSessions),
      note: t("活跃 Pi 会话"),
      icon: Radio,
      tone: "lime"
    },
    {
      label: t("今日会话"),
      value: String(data.sessionsToday),
      note: t("新创建"),
      icon: Activity,
      tone: "teal"
    },
    {
      label: t("今日 Token"),
      value: formatNumber(data.inputTokensToday + data.outputTokensToday),
      note: t("{{input}} 输入 · {{output}} 输出", {
        input: formatNumber(data.inputTokensToday),
        output: formatNumber(data.outputTokensToday)
      }),
      icon: Sparkles,
      tone: "violet"
    },
    {
      label: t("已知成本"),
      value: formatCost(data.reportedCostToday),
      note: t("Provider 报告值"),
      icon: Coins,
      tone: "amber"
    }
  ];

  return (
    <div className={ui("dashboard-page")}>
      <header className={ui("page-header hero-header")}>
        <div>
          <p className={ui("eyebrow")}>RUNTIME OVERVIEW</p>
          <h1>{t("运行总览")}</h1>
          <p>{t("掌握 Pi 会话、定时任务和今日用量。")}</p>
        </div>
        <Link className={ui("button button-primary")} to="/" aria-label={t("新建会话")}>
          <MessageSquarePlus size={17} />
          {t("新建会话")}
        </Link>
      </header>

      {system?.warning && (
        <div className={ui("security-warning")}>
          <CircleAlert size={18} />
          <span>{system.warning}</span>
        </div>
      )}

      <section className={ui("metric-grid")} aria-label={t("今日指标")}>
        {metrics.map(({ label, value, note, icon: Icon, tone }) => (
          <article className={ui("metric-card")} key={label}>
            <div className={ui(`metric-icon metric-${tone}`)}>
              <Icon size={18} />
            </div>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{note}</small>
          </article>
        ))}
      </section>

      <section className={ui("dashboard-grid")}>
        <article className={ui("panel")}>
          <div className={ui("panel-heading")}>
            <div>
              <p className={ui("eyebrow")}>SESSIONS</p>
              <h2>{t("最近会话")}</h2>
            </div>
            <Link to="/sessions" className={ui("text-link")}>
              {t("查看全部")} <ArrowRight size={15} />
            </Link>
          </div>
          <div className={ui("row-list")}>
            {data.recentSessions.length === 0 ? (
              <p className={ui("panel-empty")}>{t("还没有会话。创建一个，让 Pi 开始工作。")}</p>
            ) : (
              data.recentSessions.map((session) => (
                <Link
                  className={ui("session-row")}
                  to={`/sessions/${session.id}`}
                  key={session.id}
                >
                  <div className={ui("row-avatar")}>{session.displayName.slice(0, 1).toUpperCase()}</div>
                  <div className={ui("row-main")}>
                    <strong>{session.displayName}</strong>
                    <span title={session.cwd}>{session.cwd}</span>
                  </div>
                  <div className={ui("row-meta")}>
                    <StatusDot status={session.status} />
                    <time>{formatDate(session.updatedAt)}</time>
                  </div>
                </Link>
              ))
            )}
          </div>
        </article>

        <article className={ui("panel")}>
          <div className={ui("panel-heading")}>
            <div>
              <p className={ui("eyebrow")}>SCHEDULER</p>
              <h2>{t("最近运行")}</h2>
            </div>
            <Link to="/schedules" className={ui("text-link")}>
              {t("管理调度")} <ArrowRight size={15} />
            </Link>
          </div>
          <div className={ui("timeline")}>
            {data.recentRuns.length === 0 ? (
              <p className={ui("panel-empty")}>{t("暂无 Cron 运行记录。")}</p>
            ) : (
              data.recentRuns.map((run) => (
                <div className={ui("timeline-row")} key={run.id}>
                  <div className={ui("timeline-icon")}>
                    <CalendarClock size={16} />
                  </div>
                  <div>
                    <strong>{run.triggerType === "cron" ? t("Cron 触发") : t("立即运行")}</strong>
                    <span>{formatDate(run.scheduledFor)}</span>
                  </div>
                  <StatusDot status={run.status} />
                </div>
              ))
            )}
          </div>
        </article>
      </section>

      {data.recentProblems.length > 0 && (
        <section className={ui("problem-strip")}>
          <CircleAlert size={18} />
          <div>
            <strong>{t("最近有 {{count}} 个会话需要留意", {
              count: data.recentProblems.length
            })}</strong>
            <span>
              {data.recentProblems.map((session) => session.displayName).join("、")}
            </span>
          </div>
          <Link to="/sessions">{t("查看详情")}</Link>
        </section>
      )}
    </div>
  );
}
