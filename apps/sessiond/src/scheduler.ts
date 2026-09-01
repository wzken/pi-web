import type { PiWebConfig } from "@pi-web/config";
import { jobInputSchema, type ScheduledJob, type SessionRecord } from "@pi-web/protocol";
import { nowIso, PiWebError, safeErrorMessage } from "@pi-web/shared";
import { humanizeCron, nextOccurrence, validateSchedule } from "./cron.js";
import { NotificationCenter } from "./notification-center.js";
import { PiManager } from "./pi-manager.js";
import { ScheduleStore } from "./schedule-store.js";
import { SessionSupervisor } from "./supervisor.js";

interface ActiveTimer {
  timeout: NodeJS.Timeout;
  grace: NodeJS.Timeout | null;
}

export class Scheduler {
  readonly #schedules: ScheduleStore;
  readonly #supervisor: SessionSupervisor;
  readonly #piManager: PiManager;
  readonly #notifications: NotificationCenter;
  #config: PiWebConfig;
  #tickTimer: NodeJS.Timeout | null = null;
  readonly #activeTimers = new Map<string, ActiveTimer>();
  readonly #inFlight = new Set<Promise<unknown>>();
  #ticking = false;
  #stopping = false;
  readonly #handleSupervisorStatus = (session: SessionRecord) => {
    if (this.#stopping) return;
    void this.#trackTask(this.#onSessionStatus(session)).catch(
      () => undefined
    );
  };

  constructor(
    schedules: ScheduleStore,
    supervisor: SessionSupervisor,
    piManager: PiManager,
    config: PiWebConfig,
    notifications: NotificationCenter
  ) {
    this.#schedules = schedules;
    this.#supervisor = supervisor;
    this.#piManager = piManager;
    this.#config = config;
    this.#notifications = notifications;
    supervisor.on("status", this.#handleSupervisorStatus);
  }

  updateConfig(config: PiWebConfig): void {
    this.#config = config;
  }

  start(): void {
    if (this.#stopping) {
      throw new PiWebError(
        "SESSIOND_STOPPING",
        "Session daemon is stopping",
        503
      );
    }
    this.recomputeFutureRuns();
    this.#tickTimer = setInterval(
      () => void this.tick().catch(() => undefined),
      15_000
    );
    this.#tickTimer.unref();
    void this.tick().catch(() => undefined);
  }

  stop(): void {
    this.#stopping = true;
    this.#supervisor.off("status", this.#handleSupervisorStatus);
    if (this.#tickTimer) clearInterval(this.#tickTimer);
    this.#tickTimer = null;
    for (const timers of this.#activeTimers.values()) {
      clearTimeout(timers.timeout);
      if (timers.grace) clearTimeout(timers.grace);
    }
    this.#activeTimers.clear();
  }

  async shutdown(): Promise<void> {
    this.stop();
    while (this.#inFlight.size > 0) {
      await Promise.allSettled([...this.#inFlight]);
    }
  }

  recomputeFutureRuns(): void {
    const now = new Date();
    for (const job of this.#schedules.listJobs()) {
      if (!job.enabled) continue;
      const next = nextOccurrence(job.cronExpression, job.timezone, now);
      this.#schedules.updateJobSchedule(job.id, next);
    }
  }

  tick(): Promise<void> {
    return this.#trackTask(this.#tick());
  }

  async #tick(): Promise<void> {
    if (this.#stopping) return;
    if (this.#ticking) return;
    this.#ticking = true;
    try {
      const now = nowIso();
      for (const job of this.#schedules.dueJobs(now)) {
        if (this.#stopping) break;
        const scheduledFor = job.nextRunAt ?? now;
        const next = nextOccurrence(
          job.cronExpression,
          job.timezone,
          new Date(scheduledFor)
        );
        try {
          await this.#trigger(job, scheduledFor, "cron");
        } catch (error) {
          if (isWorkerLimitError(error)) break;
          throw error;
        }
        this.#schedules.updateJobTimes(job.id, scheduledFor, next);
      }
    } finally {
      this.#ticking = false;
    }
  }

  list(): ScheduledJob[] {
    return this.#schedules.listJobs();
  }

  get(id: string): ScheduledJob {
    return this.#schedules.getJob(id);
  }

  runs(jobId?: string) {
    return this.#schedules.listRuns(jobId);
  }

  async create(
    raw: unknown,
    meta: { actor: "web" | "model"; sourceSessionId?: string | null }
  ): Promise<ScheduledJob & { human: string }> {
    if (this.#schedules.countJobs() >= this.#config.maxScheduledJobs) {
      throw new PiWebError("JOB_LIMIT", "Schedule limit reached", 429);
    }
    const validated = await validateSchedule(raw, this.#config);
    await this.#assertModelExists(validated.input.model);
    const input =
      meta.actor === "model" &&
      this.#config.modelSchedulePolicy === "create_disabled"
        ? { ...validated.input, enabled: false }
        : validated.input;
    if (meta.actor === "model" && this.#config.modelSchedulePolicy === "deny") {
      throw new PiWebError(
        "MODEL_SCHEDULING_DENIED",
        "Model-created schedules are disabled",
        403
      );
    }
    const job = this.#schedules.createJob(input, {
      createdBy: meta.actor,
      ...(meta.sourceSessionId === undefined
        ? {}
        : { createdFromSessionId: meta.sourceSessionId }),
      nextRunAt: input.enabled ? validated.nextRunAt : null
    });
    return { ...job, human: validated.human };
  }

  async update(
    id: string,
    raw: unknown,
    actor: "web" | "model",
    sourceSessionId?: string
  ): Promise<ScheduledJob & { human: string }> {
    const current = this.#schedules.getJob(id);
    this.#assertModelOwnership(current, actor, sourceSessionId);
    const merged = jobInputSchema.parse({ ...current, ...(raw as object) });
    const validated = await validateSchedule(merged, this.#config);
    await this.#assertModelExists(validated.input.model);
    const job = this.#schedules.updateJob(
      id,
      validated.input,
      validated.input.enabled ? validated.nextRunAt : null,
      actor,
      sourceSessionId
    );
    return { ...job, human: validated.human };
  }

  setEnabled(
    id: string,
    enabled: boolean,
    actor: "web" | "model",
    sourceSessionId?: string
  ): ScheduledJob & { human: string } {
    const current = this.#schedules.getJob(id);
    this.#assertModelOwnership(current, actor, sourceSessionId);
    const next = enabled
      ? nextOccurrence(current.cronExpression, current.timezone)
      : null;
    const job = this.#schedules.setJobEnabled(
      id,
      enabled,
      next,
      actor,
      sourceSessionId
    );
    return {
      ...job,
      human: humanizeCron(job.cronExpression, job.timezone)
    };
  }

  delete(
    id: string,
    actor: "web" | "model",
    sourceSessionId?: string
  ): { id: string; deleted: true } {
    const current = this.#schedules.getJob(id);
    this.#assertModelOwnership(current, actor, sourceSessionId);
    this.#schedules.deleteJob(id, actor, sourceSessionId);
    return { id, deleted: true };
  }

  async runNow(
    id: string,
    actor: "web" | "model",
    sourceSessionId?: string
  ) {
    const job = this.#schedules.getJob(id);
    this.#assertModelOwnership(job, actor, sourceSessionId);
    this.#schedules.recordRunNow(id, actor, sourceSessionId);
    return await this.#trigger(
      job,
      nowIso(),
      actor === "model" ? "model_run_now" : "manual"
    );
  }

  async tool(
    raw: Record<string, unknown>,
    sourceSessionId: string
  ): Promise<unknown> {
    const action = String(raw.action ?? "");
    const jobId = typeof raw.jobId === "string" ? raw.jobId : "";
    if (action === "list") {
      return this.#jobsVisibleToSession(sourceSessionId).map((job) => ({
        ...job,
        human: humanizeCron(job.cronExpression, job.timezone)
      }));
    }
    if (action === "get") {
      const job = this.get(jobId);
      this.#assertModelOwnership(job, "model", sourceSessionId);
      return { ...job, human: humanizeCron(job.cronExpression, job.timezone) };
    }
    if (action === "create") {
      return await this.create(raw, { actor: "model", sourceSessionId });
    }
    if (action === "update") {
      return await this.update(jobId, raw, "model", sourceSessionId);
    }
    if (action === "enable" || action === "disable") {
      return this.setEnabled(
        jobId,
        action === "enable",
        "model",
        sourceSessionId
      );
    }
    if (action === "delete") {
      return this.delete(jobId, "model", sourceSessionId);
    }
    if (action === "run_now") {
      return await this.runNow(jobId, "model", sourceSessionId);
    }
    throw new PiWebError("INVALID_SCHEDULE_ACTION", "Unknown schedule action", 400);
  }

  #trigger(
    job: ScheduledJob,
    scheduledFor: string,
    triggerType: "cron" | "manual" | "model_run_now"
  ) {
    return this.#trackTask(
      this.#performTrigger(job, scheduledFor, triggerType)
    );
  }

  async #performTrigger(
    job: ScheduledJob,
    scheduledFor: string,
    triggerType: "cron" | "manual" | "model_run_now"
  ) {
    if (this.#stopping) {
      throw new PiWebError(
        "SESSIOND_STOPPING",
        "Session daemon is stopping",
        503
      );
    }
    if (this.#schedules.activeRunForJob(job.id)) {
      return this.#schedules.createRun({
        jobId: job.id,
        scheduledFor,
        triggerType,
        status: "skipped_overlap",
        errorSummary: "Previous run is still active"
      });
    }
    const run = this.#schedules.createRun({
      jobId: job.id,
      scheduledFor,
      triggerType,
      status: "running"
    });
    try {
      const session = await this.#supervisor.create({
        cwd: job.cwd,
        displayName: scheduledSessionDisplayName(job.name, scheduledFor),
        prompt: job.prompt,
        model: job.model,
        thinkingLevel: job.thinkingLevel,
        createdBy: "cron",
        scheduleRunId: run.id
      });
      const updated = this.#schedules.updateRun(run.id, {
        sessionId: session.id,
        startedAt: nowIso()
      });
      if (this.#stopping) {
        await this.#supervisor
          .close(session.id, "scheduler")
          .catch(() => undefined);
        return this.#schedules.updateRun(run.id, {
          status: "cancelled",
          endedAt: nowIso(),
          errorSummary: "Session daemon stopped"
        });
      }
      const timeout = setTimeout(
        () =>
          void this.#trackTask(
            this.#timeoutRun(run.id, session.id)
          ).catch(() => undefined),
        job.timeoutSeconds * 1000
      );
      timeout.unref();
      this.#activeTimers.set(run.id, { timeout, grace: null });
      return updated;
    } catch (error) {
      if (isWorkerLimitError(error)) {
        this.#schedules.updateRun(run.id, {
          status: "cancelled",
          endedAt: nowIso(),
          errorSummary: "Deferred because the worker limit was reached"
        });
        throw error;
      }
      const failed = this.#schedules.updateRun(run.id, {
        status: "failed",
        endedAt: nowIso(),
        errorSummary: safeErrorMessage(error)
      });
      this.#notifications.scheduleFailed(
        job,
        failed,
        failed.errorSummary ?? "Scheduled task failed to start"
      );
      return failed;
    }
  }

  async #onSessionStatus(session: SessionRecord): Promise<void> {
    if (!session.scheduleRunId) return;
    const run = this.#schedules.getRun(session.scheduleRunId);
    if (run.status !== "running") return;
    if (session.status === "waiting") {
      this.#finishRun(run.id, "succeeded", session);
      await this.#supervisor.close(session.id, "scheduler");
    } else if (session.status === "failed" || session.status === "interrupted") {
      this.#finishRun(run.id, "failed", session, session.interruptionReason);
    } else if (session.status === "closed") {
      this.#finishRun(run.id, "cancelled", session, "Worker closed before settling");
    }
  }

  #finishRun(
    runId: string,
    status: "succeeded" | "failed" | "cancelled",
    session: SessionRecord,
    errorSummary?: string | null
  ): void {
    const timers = this.#activeTimers.get(runId);
    if (timers) {
      clearTimeout(timers.timeout);
      if (timers.grace) clearTimeout(timers.grace);
      this.#activeTimers.delete(runId);
    }
    const updated = this.#schedules.updateRun(runId, {
      status,
      endedAt: nowIso(),
      errorSummary: errorSummary ?? null,
      inputTokens: session.inputTokens,
      outputTokens: session.outputTokens,
      reportedCost: session.reportedCost,
      estimatedCost: session.estimatedCost
    });
    if (status === "failed") {
      this.#notifications.scheduleFailed(
        this.#schedules.getJob(updated.jobId),
        updated,
        updated.errorSummary ?? "Scheduled task failed"
      );
    }
  }

  async #timeoutRun(runId: string, sessionId: string): Promise<void> {
    const run = this.#schedules.getRun(runId);
    if (run.status !== "running") return;
    const timedOut = this.#schedules.updateRun(runId, {
      status: "timed_out",
      endedAt: nowIso(),
      errorSummary: "Run exceeded its timeout"
    });
    this.#notifications.scheduleFailed(
      this.#schedules.getJob(timedOut.jobId),
      timedOut,
      "Run exceeded its timeout"
    );
    await this.#supervisor.abort(sessionId, "scheduler").catch(() => undefined);
    const timers = this.#activeTimers.get(runId);
    if (!timers) return;
    if (this.#stopping) {
      this.#activeTimers.delete(runId);
      return;
    }
    timers.grace = setTimeout(() => {
      void this.#trackTask(
        this.#supervisor
          .close(sessionId, "scheduler")
          .finally(() => this.#activeTimers.delete(runId))
      ).catch(() => undefined);
    }, 10_000);
    timers.grace.unref();
  }

  #assertModelOwnership(
    job: ScheduledJob,
    actor: "web" | "model",
    sourceSessionId?: string
  ): void {
    if (actor !== "model") return;
    if (this.#config.modelSchedulePolicy === "deny") {
      throw new PiWebError("MODEL_SCHEDULING_DENIED", "Model scheduling is disabled", 403);
    }
    if (!sourceSessionId || job.createdFromSessionId !== sourceSessionId) {
      throw new PiWebError(
        "MODEL_JOB_SCOPE",
        "A model may only modify schedules created from this session",
        403
      );
    }
  }

  #jobsVisibleToSession(sessionId: string): ScheduledJob[] {
    return this.list().filter((job) => job.createdFromSessionId === sessionId);
  }

  async #assertModelExists(model: string | null): Promise<void> {
    if (!model) return;
    const exists = await this.#piManager.modelExists(model).catch((error) => {
      throw new PiWebError(
        "PI_MODEL_CHECK_FAILED",
        `Could not verify the selected Pi model: ${safeErrorMessage(error)}`,
        503
      );
    });
    if (!exists) {
      throw new PiWebError(
        "MODEL_NOT_FOUND",
        `Pi does not report the model ${model}`,
        400
      );
    }
  }

  #trackTask<T>(task: Promise<T>): Promise<T> {
    this.#inFlight.add(task);
    void task
      .finally(() => this.#inFlight.delete(task))
      .catch(() => undefined);
    return task;
  }
}

function isWorkerLimitError(error: unknown): boolean {
  return error instanceof PiWebError && error.code === "WORKER_LIMIT";
}

export function scheduledSessionDisplayName(
  jobName: string,
  scheduledFor: string
): string {
  const timestamp = new Date(scheduledFor);
  if (!Number.isFinite(timestamp.getTime())) return `${jobName} · ${scheduledFor}`;
  const compactIso = timestamp
    .toISOString()
    .slice(0, 16)
    .replace("T", " ");
  return `${jobName} · ${compactIso}Z`;
}
