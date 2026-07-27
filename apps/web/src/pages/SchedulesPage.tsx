import {
  CalendarClock,
  ChevronRight,
  Clock3,
  Edit3,
  History,
  Play,
  Plus,
  Trash2,
  X
} from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type {
  ScheduledJob,
  ScheduledRun,
  ThinkingLevel
} from "@pi-web/protocol";
import { api, formatDate, isAbortError, jsonBody } from "../api";
import {
  ActionMenu,
  ActionMenuItem,
  Button,
  ButtonLink,
  EmptyState,
  ErrorBanner,
  IconButton,
  Loading,
  StatusDot,
  Switch,
  useToast
} from "../components";
import { t } from "../i18n";
import { ui } from "../ui";

type EditableJob = Omit<
  ScheduledJob,
  | "id"
  | "createdBy"
  | "createdFromSessionId"
  | "createdAt"
  | "updatedAt"
  | "lastRunAt"
  | "nextRunAt"
>;

const initialJob: EditableJob = {
  name: "",
  enabled: true,
  cronExpression: "0 9 * * *",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  cwd: "",
  prompt: "",
  model: null,
  thinkingLevel: null,
  timeoutSeconds: 3600,
  overlapPolicy: "skip"
};

export function SchedulesPage() {
  const [jobs, setJobs] = useState<ScheduledJob[] | null>(null);
  const [latestRuns, setLatestRuns] = useState<Map<string, ScheduledRun>>(
    new Map()
  );
  const [editing, setEditing] = useState<ScheduledJob | "new" | null>(null);
  const [historyJob, setHistoryJob] = useState<ScheduledJob | null>(null);
  const [scheduleDefaults, setScheduleDefaults] = useState({
    timezone: initialJob.timezone,
    timeoutSeconds: initialJob.timeoutSeconds
  });
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState<string | null>(null);
  const toast = useToast();

  const refresh = useCallback(
    (signal?: AbortSignal) =>
      Promise.all([
        api<ScheduledJob[]>("/api/schedules", signal ? { signal } : {}),
        api<ScheduledRun[]>(
          "/api/schedule-runs",
          signal ? { signal } : {}
        )
      ])
        .then(([items, runs]) => {
          setJobs(items);
          setLatestRuns(
            new Map(
              runs
                .slice()
                .reverse()
                .map((run) => [run.jobId, run])
            )
          );
        })
        .catch((reason) => {
          if (!isAbortError(reason)) setError(reason);
        }),
    []
  );
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    api<{
      defaultTimezone: string;
      defaultCronTimeoutSeconds: number;
    }>("/api/settings", { signal: controller.signal })
      .then((settings) =>
        setScheduleDefaults({
          timezone: settings.defaultTimezone,
          timeoutSeconds: settings.defaultCronTimeoutSeconds
        })
      )
      .catch((reason) => {
        if (!isAbortError(reason)) setError(reason);
      });
    return () => controller.abort();
  }, [refresh]);

  async function toggle(job: ScheduledJob) {
    if (pending) return;
    setPending(`toggle:${job.id}`);
    try {
      await api(`/api/schedules/${job.id}/enabled`, {
        method: "POST",
        ...jsonBody({ enabled: !job.enabled })
      });
      toast.push(job.enabled ? t("调度已停用") : t("调度已启用"));
      await refresh();
    } catch (reason) {
      setError(reason);
    } finally {
      setPending(null);
    }
  }

  async function runNow(job: ScheduledJob) {
    if (pending) return;
    setPending(`run:${job.id}`);
    try {
      const run = await api<ScheduledRun>(`/api/schedules/${job.id}/run`, {
        method: "POST"
      });
      toast.push(
        run.status === "skipped_overlap"
          ? t("已有运行，本次已按策略跳过")
          : t("已创建立即运行")
      );
      setHistoryJob(job);
    } catch (reason) {
      setError(reason);
    } finally {
      setPending(null);
    }
  }

  async function remove(job: ScheduledJob) {
    if (!confirm(t("删除“{{name}}”？历史运行和对应会话会保留。", {
      name: job.name
    }))) return;
    if (pending) return;
    setPending(`delete:${job.id}`);
    try {
      await api(`/api/schedules/${job.id}`, { method: "DELETE" });
      toast.push(t("调度已删除"));
      await refresh();
    } catch (reason) {
      setError(reason);
    } finally {
      setPending(null);
    }
  }

  if (error && !jobs) return <ErrorBanner error={error} />;
  if (!jobs) return <Loading label={t("读取 Cron 调度")} />;

  return (
    <>
      <header className={ui("page-header")}>
        <div>
          <p className={ui("eyebrow")}>SCHEDULER</p>
          <h1>{t("调度")}</h1>
          <p>{t("每次触发都会创建独立 Pi 会话；错过的运行不会在重启后补跑。")}</p>
        </div>
        <Button variant={jobs.length === 0 ? "secondary" : "primary"} onClick={() => setEditing("new")}>
          <Plus size={17} />
          {t("新建调度")}
        </Button>
      </header>

      {error !== null && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      {jobs.length === 0 ? (
        <EmptyState
          icon={<CalendarClock size={27} />}
          title={t("还没有定时任务")}
          action={<Button onClick={() => setEditing("new")}>{t("创建第一个调度")}</Button>}
        >
          {t("使用标准五段 Cron 和 IANA 时区，让 Pi 在指定目录按时工作。")}
        </EmptyState>
      ) : (
        <div className={ui("schedule-list")}>
          {jobs.map((job) => (
            <article className={ui(`schedule-card ${job.enabled ? "" : "disabled"}`)} key={job.id}>
              <div className={ui("schedule-accent")} />
              <div className={ui("schedule-main")}>
                <div className={ui("schedule-heading")}>
                  <div>
                    <h2>{job.name}</h2>
                    <p>{humanCron(job.cronExpression, job.timezone)}</p>
                  </div>
                  <div className={ui("schedule-switch-row")}>
                    <span>{job.enabled ? t("已启用") : t("已停用")}</span>
                    <Switch
                      label={t(job.enabled ? "停用调度 {{name}}" : "启用调度 {{name}}", {
                        name: job.name
                      })}
                      checked={job.enabled}
                      loading={pending === `toggle:${job.id}`}
                      disabled={pending !== null}
                      onClick={() => void toggle(job)}
                    />
                  </div>
                </div>
                <div className={ui("schedule-details")}>
                  <span>
                    <Clock3 size={14} />
                    {t("下次：{{date}}", { date: formatDate(job.nextRunAt) })}
                  </span>
                  <span title={job.cwd}>{job.cwd}</span>
                  <span>{job.model ?? t("默认模型")}</span>
                  <span>{t("{{count}} 分钟超时", {
                    count: Math.round(job.timeoutSeconds / 60)
                  })}</span>
                </div>
                <div className={ui("schedule-foot")}>
                  <div>
                    <span>{t("上次运行 {{date}}", { date: formatDate(job.lastRunAt) })}</span>
                    {latestRuns.get(job.id) && (
                      <StatusDot status={latestRuns.get(job.id)!.status} />
                    )}
                    <span>{t("来源：{{source}}", { source: job.createdBy })}</span>
                  </div>
                  <div className={ui("card-actions")}>
                    <Button size="sm" variant="ghost" onClick={() => setHistoryJob(job)}>
                      <History size={15} />
                      {t("历史")}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={pending === `run:${job.id}`}
                      loadingLabel={t("运行中…")}
                      disabled={pending !== null}
                      onClick={() => void runNow(job)}
                    >
                      <Play size={15} />
                      {t("立即运行")}
                    </Button>
                    <ActionMenu label={t("更多调度操作 {{name}}", { name: job.name })}>
                      <ActionMenuItem
                        disabled={pending !== null}
                        onClick={() => setEditing(job)}
                      >
                        <Edit3 size={14} />
                        {t("编辑")}
                      </ActionMenuItem>
                      <ActionMenuItem
                        danger
                        disabled={pending !== null}
                        onClick={() => void remove(job)}
                      >
                        <Trash2 size={14} />
                        {t("删除")}
                      </ActionMenuItem>
                    </ActionMenu>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {editing && (
        <ScheduleDialog
          job={editing === "new" ? null : editing}
          defaults={scheduleDefaults}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
        />
      )}
      {historyJob && (
        <RunHistory job={historyJob} onClose={() => setHistoryJob(null)} />
      )}
    </>
  );
}

function ScheduleDialog({
  job,
  defaults,
  onClose,
  onSaved
}: {
  job: ScheduledJob | null;
  defaults: { timezone: string; timeoutSeconds: number };
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [value, setValue] = useState<EditableJob>(
    job
      ? {
          name: job.name,
          enabled: job.enabled,
          cronExpression: job.cronExpression,
          timezone: job.timezone,
          cwd: job.cwd,
          prompt: job.prompt,
          model: job.model,
          thinkingLevel: job.thinkingLevel,
          timeoutSeconds: job.timeoutSeconds,
          overlapPolicy: "skip"
        }
      : {
          ...initialJob,
          timezone: defaults.timezone,
          timeoutSeconds: defaults.timeoutSeconds
        }
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  function patch<K extends keyof EditableJob>(key: K, next: EditableJob[K]) {
    setValue((current) => ({ ...current, [key]: next }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api(job ? `/api/schedules/${job.id}` : "/api/schedules", {
        method: job ? "PUT" : "POST",
        ...jsonBody(value)
      });
      toast.push(job ? t("调度已更新") : t("调度已创建"));
      await onSaved();
    } catch (reason) {
      setError(reason);
      setBusy(false);
    }
  }

  return (
    <div className={ui("dialog-backdrop")} onPointerDown={onClose}>
      <form className={ui("dialog schedule-dialog")} onSubmit={submit} onPointerDown={(event) => event.stopPropagation()}>
        <div className={ui("schedule-dialog-body")}>
          <div className={ui("dialog-heading")}>
            <div>
              <p className={ui("eyebrow")}>{job ? "EDIT SCHEDULE" : "NEW SCHEDULE"}</p>
              <h2>{job ? t("编辑调度") : t("新建调度")}</h2>
            </div>
            <IconButton type="button" label={t("关闭调度编辑")} onClick={onClose}><X size={20} /></IconButton>
          </div>
          {error !== null && <ErrorBanner error={error} onDismiss={() => setError(null)} />}
          <label className={ui("field")}>
            <span>{t("名称")}</span>
            <input value={value.name} onChange={(event) => patch("name", event.target.value)} required />
          </label>
          <div className={ui("field-row")}>
            <label className={ui("field")}>
              <span>{t("Cron 表达式")}</span>
              <input
                className={ui("mono")}
                value={value.cronExpression}
                onChange={(event) => patch("cronExpression", event.target.value)}
                required
              />
              <small>{humanCron(value.cronExpression, value.timezone)}</small>
            </label>
            <label className={ui("field")}>
              <span>{t("IANA 时区")}</span>
              <input value={value.timezone} onChange={(event) => patch("timezone", event.target.value)} required />
            </label>
          </div>
          <label className={ui("field")}>
            <span>{t("工作目录")}</span>
            <input value={value.cwd} onChange={(event) => patch("cwd", event.target.value)} placeholder="/home/user/project" required />
          </label>
          <label className={ui("field")}>
            <span>{t("Pi 指令")}</span>
            <textarea rows={5} value={value.prompt} onChange={(event) => patch("prompt", event.target.value)} required />
          </label>
          <div className={ui("field-row three")}>
            <label className={ui("field")}>
              <span>{t("模型")}</span>
              <input
                value={value.model ?? ""}
                onChange={(event) => patch("model", event.target.value || null)}
                placeholder={t("使用默认值")}
              />
            </label>
            <label className={ui("field")}>
              <span>{t("思考级别")}</span>
              <select
                value={value.thinkingLevel ?? ""}
                onChange={(event) =>
                  patch("thinkingLevel", (event.target.value || null) as ThinkingLevel | null)
                }
              >
                <option value="">{t("默认")}</option>
                {["off", "minimal", "low", "medium", "high", "xhigh", "max"].map((level) => (
                  <option key={level}>{level}</option>
                ))}
              </select>
            </label>
            <label className={ui("field")}>
              <span>{t("超时（秒）")}</span>
              <input
                type="number"
                min={60}
                max={86400}
                value={value.timeoutSeconds}
                onChange={(event) => patch("timeoutSeconds", Number(event.target.value))}
              />
            </label>
          </div>
          <div className={ui("switch-setting-row")}>
            <span>
              <strong>{t("创建后立即启用")}</strong>
              <small>{t("重叠运行默认跳过，不会自动重试。")}</small>
            </span>
            <Switch
              label={t("创建后立即启用")}
              checked={value.enabled}
              onClick={() => patch("enabled", !value.enabled)}
            />
          </div>
        </div>
        <div className={ui("dialog-actions")}>
          <Button type="button" variant="secondary" onClick={onClose}>{t("取消")}</Button>
          <Button type="submit" loading={busy} loadingLabel={t("保存中…")}>{t("保存调度")}</Button>
        </div>
      </form>
    </div>
  );
}

function RunHistory({ job, onClose }: { job: ScheduledJob; onClose: () => void }) {
  const [runs, setRuns] = useState<ScheduledRun[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    const controller = new AbortController();
    api<ScheduledRun[]>(`/api/schedules/${job.id}/runs`, {
      signal: controller.signal
    })
      .then(setRuns)
      .catch((reason) => {
        if (!isAbortError(reason)) setError(reason);
      });
    return () => controller.abort();
  }, [job.id]);
  return (
    <div className={ui("drawer-backdrop")} onPointerDown={onClose}>
      <aside className={ui("history-drawer")} onPointerDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <p className={ui("eyebrow")}>RUN HISTORY</p>
            <h2>{job.name}</h2>
          </div>
          <IconButton label={t("关闭运行历史")} onClick={onClose}><X size={19} /></IconButton>
        </header>
        {error !== null && <ErrorBanner error={error} />}
        {!runs ? (
          <Loading />
        ) : runs.length === 0 ? (
          <EmptyState icon={<History size={24} />} title={t("暂无运行记录")}>{t("立即运行一次，或等待下一次 Cron 触发。")}</EmptyState>
        ) : (
          <div className={ui("run-list")}>
            {runs.map((run) => (
              <div className={ui("run-row")} key={run.id}>
                <div className={ui("run-line")} />
                <div className={ui("run-main")}>
                  <div>
                    <StatusDot status={run.status} />
                    <span>{run.triggerType}</span>
                  </div>
                  <time>{formatDate(run.scheduledFor)}</time>
                  {run.errorSummary && <p>{run.errorSummary}</p>}
                </div>
                {run.sessionId && (
                  <ButtonLink to={`/sessions/${run.sessionId}`} variant="toolbar" size="icon" tooltip={t("打开会话")} aria-label={t("打开会话")}>
                    <ChevronRight size={18} />
                  </ButtonLink>
                )}
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}

function humanCron(expression: string, timezone: string): string {
  const parts = expression.trim().split(/\s+/);
  if (parts.length === 5 && /^\d+$/.test(parts[0]!) && /^\d+$/.test(parts[1]!)) {
    return t("每天 {{time}} · {{timezone}}", {
      time: `${parts[1]!.padStart(2, "0")}:${parts[0]!.padStart(2, "0")}`,
      timezone
    });
  }
  if (parts.length === 5 && parts[0]?.startsWith("*/")) {
    return t("每 {{count}} 分钟 · {{timezone}}", {
      count: parts[0].slice(2),
      timezone
    });
  }
  return `${expression} · ${timezone}`;
}
