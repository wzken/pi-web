import {
  CalendarClock,
  ChevronRight,
  Clock3,
  Edit3,
  Folder,
  History,
  Play,
  Plus,
  Timer,
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
  Dialog,
  EmptyState,
  ErrorBanner,
  IconButton,
  Loading,
  StatusDot,
  Switch,
  useToast
} from "../components";
import { t } from "../i18n";
import { ModelSelect } from "../ModelSelect";
import { DirectoryPicker } from "../DirectoryPicker";
import { ThinkingLevelControl } from "../ThinkingLevelControl";
import { ui } from "../ui";
import styles from "./SchedulesPage.module.css";

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
  const [allowedRoots, setAllowedRoots] = useState<string[]>([]);
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
      allowedRoots: string[];
      defaultTimezone: string;
      defaultCronTimeoutSeconds: number;
    }>("/api/settings", { signal: controller.signal })
      .then((settings) => {
        setAllowedRoots(settings.allowedRoots);
        setScheduleDefaults({
          timezone: settings.defaultTimezone,
          timeoutSeconds: settings.defaultCronTimeoutSeconds
        });
      })
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
    if (
      !confirm(
        t("删除“{{name}}”？历史运行和对应会话会保留。", {
          name: job.name
        })
      )
    ) {
      return;
    }
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

  const enabledCount = jobs.filter((job) => job.enabled).length;
  const nextJob = jobs
    .filter((job) => job.enabled && job.nextRunAt)
    .slice()
    .sort(
      (left, right) =>
        Date.parse(left.nextRunAt ?? "") - Date.parse(right.nextRunAt ?? "")
    )[0];

  return (
    <section className={ui(styles.page, "schedules-page")}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>AUTOMATIONS</p>
          <h1>{t("调度")}</h1>
          <p>
            {t(
              "每次触发都会创建独立 Pi 会话；错过的运行不会在重启后补跑。"
            )}
          </p>
        </div>
        <Button
          variant={jobs.length === 0 ? "secondary" : "primary"}
          onClick={() => setEditing("new")}
        >
          <Plus size={17} aria-hidden="true" />
          {t("新建调度")}
        </Button>
      </header>

      {error !== null && (
        <ErrorBanner error={error} onDismiss={() => setError(null)} />
      )}

      <section className={styles.overview} aria-label={t("调度")}>
        <div className={styles.nextOverview}>
          <div className={styles.overviewIcon}>
            <CalendarClock size={22} aria-hidden="true" />
          </div>
          <div className={styles.nextOverviewCopy}>
            <span>{t("下次：{{date}}", { date: "" })}</span>
            <strong>
              {nextJob
                ? formatDate(nextJob.nextRunAt)
                : jobs.length === 0
                  ? t("还没有定时任务")
                  : t("已停用")}
            </strong>
            <small>
              {nextJob
                ? `${nextJob.name} · ${humanCron(
                    nextJob.cronExpression,
                    nextJob.timezone
                  )}`
                : jobs.length === 0
                  ? t("创建第一个调度")
                  : t("立即运行一次，或等待下一次 Cron 触发。")}
            </small>
          </div>
        </div>
        <dl className={styles.overviewStats}>
          <div>
            <dt>{t("调度")}</dt>
            <dd>{jobs.length}</dd>
          </div>
          <div>
            <dt>{t("已启用")}</dt>
            <dd>{enabledCount}</dd>
          </div>
          <div>
            <dt>{t("已停用")}</dt>
            <dd>{jobs.length - enabledCount}</dd>
          </div>
        </dl>
      </section>

      {jobs.length === 0 ? (
        <div className={styles.emptyWrap}>
          <EmptyState
            icon={<CalendarClock size={27} />}
            title={t("还没有定时任务")}
            action={
              <Button onClick={() => setEditing("new")}>
                {t("创建第一个调度")}
              </Button>
            }
          >
            {t(
              "使用标准五段 Cron 和 IANA 时区，让 Pi 在指定目录按时工作。"
            )}
          </EmptyState>
        </div>
      ) : (
        <section className={styles.jobSection} aria-labelledby="schedule-list-title">
          <div className={styles.sectionHeading}>
            <div>
              <h2 id="schedule-list-title">{t("调度")}</h2>
              <span>{jobs.length}</span>
            </div>
            <p>
              {t(
                "每次触发都会创建独立 Pi 会话；错过的运行不会在重启后补跑。"
              )}
            </p>
          </div>
          <div className={styles.scheduleList}>
            {jobs.map((job) => {
              const latestRun = latestRuns.get(job.id);
              return (
                <article
                  className={ui(
                    styles.scheduleCard,
                    !job.enabled && styles.scheduleDisabled
                  )}
                  key={job.id}
                >
                  <header className={styles.cardHeader}>
                    <div className={styles.cardTitle}>
                      <div
                        className={styles.scheduleGlyph}
                        data-enabled={String(job.enabled)}
                      >
                        <CalendarClock size={18} aria-hidden="true" />
                      </div>
                      <div>
                        <div className={styles.statusLine}>
                          <span
                            className={styles.enabledDot}
                            data-enabled={String(job.enabled)}
                          />
                          {job.enabled ? t("已启用") : t("已停用")}
                        </div>
                        <h3>{job.name}</h3>
                      </div>
                    </div>
                    <Switch
                      label={t(
                        job.enabled
                          ? "停用调度 {{name}}"
                          : "启用调度 {{name}}",
                        { name: job.name }
                      )}
                      checked={job.enabled}
                      loading={pending === `toggle:${job.id}`}
                      disabled={pending !== null}
                      onClick={() => void toggle(job)}
                    />
                  </header>

                  <div className={styles.nextRun}>
                    <Clock3 size={18} aria-hidden="true" />
                    <div>
                      <span>{t("下次：{{date}}", { date: "" })}</span>
                      <strong>
                        {job.enabled
                          ? formatDate(job.nextRunAt)
                          : t("已停用")}
                      </strong>
                    </div>
                    <code>{humanCron(job.cronExpression, job.timezone)}</code>
                  </div>

                  <dl className={styles.metadata}>
                    <div>
                      <dt>
                        <Folder size={14} aria-hidden="true" />
                        {t("工作目录")}
                      </dt>
                      <dd title={job.cwd}>{job.cwd}</dd>
                    </div>
                    <div>
                      <dt>{t("模型")}</dt>
                      <dd>{job.model ?? t("默认模型")}</dd>
                    </div>
                    <div>
                      <dt>
                        <Timer size={14} aria-hidden="true" />
                        {t("超时")}
                      </dt>
                      <dd>
                        {t("{{count}} 分钟超时", {
                          count: Math.round(job.timeoutSeconds / 60)
                        })}
                      </dd>
                    </div>
                  </dl>

                  <footer className={styles.cardFooter}>
                    <div className={styles.lastRun}>
                      <span>
                        {t("上次运行 {{date}}", {
                          date: formatDate(job.lastRunAt)
                        })}
                      </span>
                      {latestRun && <StatusDot status={latestRun.status} />}
                    </div>
                    <div className={styles.cardActions}>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setHistoryJob(job)}
                      >
                        <History size={15} aria-hidden="true" />
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
                        <Play size={15} aria-hidden="true" />
                        {t("立即运行")}
                      </Button>
                      <ActionMenu
                        label={t("更多调度操作 {{name}}", { name: job.name })}
                      >
                        <ActionMenuItem
                          disabled={pending !== null}
                          onClick={() => setEditing(job)}
                        >
                          <Edit3 size={14} aria-hidden="true" />
                          {t("编辑")}
                        </ActionMenuItem>
                        <ActionMenuItem
                          danger
                          disabled={pending !== null}
                          onClick={() => void remove(job)}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                          {t("删除")}
                        </ActionMenuItem>
                      </ActionMenu>
                    </div>
                  </footer>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {editing && (
        <ScheduleDialog
          job={editing === "new" ? null : editing}
          defaults={scheduleDefaults}
          allowedRoots={allowedRoots}
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
    </section>
  );
}

function ScheduleDialog({
  job,
  defaults,
  allowedRoots,
  onClose,
  onSaved
}: {
  job: ScheduledJob | null;
  defaults: { timezone: string; timeoutSeconds: number };
  allowedRoots: string[];
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
    <Dialog
      open
      labelledBy="schedule-dialog-title"
      onClose={onClose}
      className={ui(styles.editorDialog, "schedule-dialog")}
      maxWidth={720}
    >
      <form
        id="schedule-editor-form"
        className={styles.editorForm}
        onSubmit={submit}
      >
        <div className={styles.dialogHeading}>
          <div>
            <p className={styles.eyebrow}>
              {job ? "EDIT SCHEDULE" : "NEW SCHEDULE"}
            </p>
            <h2 id="schedule-dialog-title">
              {job ? t("编辑调度") : t("新建调度")}
            </h2>
            <p>
              {t(
                "使用标准五段 Cron 和 IANA 时区，让 Pi 在指定目录按时工作。"
              )}
            </p>
          </div>
          <IconButton
            type="button"
            label={t("关闭调度编辑")}
            onClick={onClose}
          >
            <X size={20} />
          </IconButton>
        </div>
        {error !== null && (
          <ErrorBanner error={error} onDismiss={() => setError(null)} />
        )}

        <div className={styles.formSection}>
          <label className={ui(styles.field, "field")}>
            <span>{t("名称")}</span>
            <input
              value={value.name}
              onChange={(event) => patch("name", event.target.value)}
              required
            />
          </label>
          <div className={styles.fieldGrid}>
            <label className={ui(styles.field, "field")}>
              <span>{t("Cron 表达式")}</span>
              <input
                className={ui(styles.mono, "mono")}
                value={value.cronExpression}
                onChange={(event) =>
                  patch("cronExpression", event.target.value)
                }
                required
              />
              <small>
                {humanCron(value.cronExpression, value.timezone)}
              </small>
            </label>
            <label className={ui(styles.field, "field")}>
              <span>{t("IANA 时区")}</span>
              <input
                value={value.timezone}
                onChange={(event) => patch("timezone", event.target.value)}
                required
              />
            </label>
          </div>
        </div>

        <div className={styles.formSection}>
          <div className={ui(styles.field, "field")}>
            <span>{t("工作目录")}</span>
            <DirectoryPicker
              roots={allowedRoots}
              value={value.cwd}
              disabled={busy}
              onChange={(next) => patch("cwd", next)}
            />
          </div>
          <label className={ui(styles.field, "field")}>
            <span>{t("Pi 指令")}</span>
            <textarea
              rows={5}
              value={value.prompt}
              onChange={(event) => patch("prompt", event.target.value)}
              required
            />
          </label>
        </div>

        <div className={styles.formSection}>
          <div className={styles.fieldGridThree}>
            <div className={ui(styles.field, "field")}>
              <span>{t("模型")}</span>
              <ModelSelect
                value={value.model ?? ""}
                onChange={(next) => patch("model", next || null)}
                onError={setError}
              />
            </div>
            <div className={ui(styles.field, "field")}>
              <span>{t("思考级别")}</span>
              <ThinkingLevelControl
                value={value.thinkingLevel ?? ""}
                allowDefault
                onChange={(next) =>
                  patch("thinkingLevel", (next || null) as ThinkingLevel | null)
                }
              />
            </div>
            <label className={ui(styles.field, "field")}>
              <span>{t("超时（秒）")}</span>
              <input
                type="number"
                min={60}
                max={86400}
                value={value.timeoutSeconds}
                onChange={(event) =>
                  patch("timeoutSeconds", Number(event.target.value))
                }
              />
            </label>
          </div>
          <div className={styles.switchRow}>
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
      </form>
      <div className={styles.dialogActions}>
        <Button type="button" variant="secondary" onClick={onClose}>
          {t("取消")}
        </Button>
        <Button
          form="schedule-editor-form"
          type="submit"
          loading={busy}
          loadingLabel={t("保存中…")}
          disabled={!value.cwd.trim()}
        >
          {t("保存调度")}
        </Button>
      </div>
    </Dialog>
  );
}

function RunHistory({
  job,
  onClose
}: {
  job: ScheduledJob;
  onClose: () => void;
}) {
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
    <Dialog
      open
      labelledBy="run-history-title"
      onClose={onClose}
      className={ui(styles.historyDialog)}
      maxWidth={560}
    >
      <header className={styles.dialogHeading}>
        <div>
          <p className={styles.eyebrow}>RUN HISTORY</p>
          <h2 id="run-history-title">{job.name}</h2>
          <p>
            {t("立即运行一次，或等待下一次 Cron 触发。")}
          </p>
        </div>
        <IconButton label={t("关闭运行历史")} onClick={onClose}>
          <X size={19} />
        </IconButton>
      </header>
      {error !== null && <ErrorBanner error={error} />}
      {!runs ? (
        <div className={styles.historyLoading}>
          <Loading />
        </div>
      ) : runs.length === 0 ? (
        <div className={styles.historyEmpty}>
          <EmptyState
            icon={<History size={24} />}
            title={t("暂无运行记录")}
          >
            {t("立即运行一次，或等待下一次 Cron 触发。")}
          </EmptyState>
        </div>
      ) : (
        <div className={styles.runList}>
          {runs.map((run) => (
            <article className={styles.runRow} key={run.id}>
              <div className={styles.runMarker} aria-hidden="true" />
              <div className={styles.runMain}>
                <div className={styles.runHeading}>
                  <StatusDot status={run.status} />
                  <span>{runTriggerLabel(run.triggerType)}</span>
                </div>
                <time dateTime={run.scheduledFor}>
                  {formatDate(run.scheduledFor)}
                </time>
                {run.errorSummary && <p>{run.errorSummary}</p>}
              </div>
              {run.sessionId && (
                <ButtonLink
                  to={`/sessions/${run.sessionId}`}
                  variant="toolbar"
                  size="icon"
                  tooltip={t("打开会话")}
                  aria-label={t("打开会话")}
                >
                  <ChevronRight size={18} />
                </ButtonLink>
              )}
            </article>
          ))}
        </div>
      )}
    </Dialog>
  );
}

function runTriggerLabel(trigger: ScheduledRun["triggerType"]): string {
  if (trigger === "cron") return t("Cron 触发");
  if (trigger === "manual") return t("立即运行");
  return t("Pi 指令");
}

function humanCron(expression: string, timezone: string): string {
  const parts = expression.trim().split(/\s+/);
  if (
    parts.length === 5 &&
    /^\d+$/.test(parts[0]!) &&
    /^\d+$/.test(parts[1]!)
  ) {
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
