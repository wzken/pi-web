import type { PiWebConfig } from "@pi-web/config";
import { jobInputSchema, type ScheduledJob, type SessionRecord } from "@pi-web/protocol";
import { nowIso, PiWebError, safeErrorMessage } from "@pi-web/shared";
import { SessionDatabase } from "./database.js";
import { humanizeCron, nextOccurrence, validateSchedule } from "./cron.js";
import { PiManager } from "./pi-manager.js";
import { SessionSupervisor } from "./supervisor.js";

interface ActiveTimer {
  timeout: NodeJS.Timeout;
  grace: NodeJS.Timeout | null;
}

export class Scheduler {
  readonly #db: SessionDatabase;
  readonly #supervisor: SessionSupervisor;
  readonly #piManager: PiManager;
  #config: PiWebConfig;
  #tickTimer: NodeJS.Timeout | null = null;
  readonly #activeTimers = new Map<string, ActiveTimer>();
  #ticking = false;

  constructor(
    db: SessionDatabase,
    supervisor: SessionSupervisor,
    piManager: PiManager,
    config: PiWebConfig
  ) {
    this.#db = db;
    this.#supervisor = supervisor;
    this.#piManager = piManager;
    this.#config = config;
    supervisor.on("status", (session: SessionRecord) => {
      void this.#onSessionStatus(session);
    });
  }

  updateConfig(config: PiWebConfig): void {
    this.#config = config;
  }

  start(): void {
    this.recomputeFutureRuns();
    this.#tickTimer = setInterval(() => void this.tick(), 15_000);
    this.#tickTimer.unref();
    void this.tick();
  }

  stop(): void {
    if (this.#tickTimer) clearInterval(this.#tickTimer);
    this.#tickTimer = null;
    for (const timers of this.#activeTimers.values()) {
      clearTimeout(timers.timeout);
      if (timers.grace) clearTimeout(timers.grace);
    }
    this.#activeTimers.clear();
  }

  recomputeFutureRuns(): void {
    const now = new Date();
    for (const job of this.#db.listJobs()) {
      if (!job.enabled) continue;
      const next = nextOccurrence(job.cronExpression, job.timezone, now);
      this.#db.updateJobSchedule(job.id, next);
    }
  }

  async tick(): Promise<void> {
    if (this.#ticking) return;
    this.#ticking = true;
    try {
      const now = nowIso();
      for (const job of this.#db.dueJobs(now)) {
        const scheduledFor = job.nextRunAt ?? now;
        const next = nextOccurrence(
          job.cronExpression,
          job.timezone,
          new Date(scheduledFor)
        );
        this.#db.updateJobTimes(job.id, scheduledFor, next);
        await this.#trigger(job, scheduledFor, "cron");
      }
    } finally {
      this.#ticking = false;
    }
  }

  list(): ScheduledJob[] {
    return this.#db.listJobs();
  }

  get(id: string): ScheduledJob {
    return this.#db.getJob(id);
  }

  runs(jobId?: string) {
    return this.#db.listRuns(jobId);
  }

  async create(
    raw: unknown,
    meta: { actor: "web" | "model"; sourceSessionId?: string | null }
  ): Promise<ScheduledJob & { human: string }> {
    if (this.#db.countJobs() >= this.#config.maxScheduledJobs) {
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
    const job = this.#db.createJob(input, {
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
    const current = this.#db.getJob(id);
    this.#assertModelOwnership(current, actor, sourceSessionId);
    const merged = jobInputSchema.parse({ ...current, ...(raw as object) });
    const validated = await validateSchedule(merged, this.#config);
    await this.#assertModelExists(validated.input.model);
    const job = this.#db.updateJob(
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
    const current = this.#db.getJob(id);
    this.#assertModelOwnership(current, actor, sourceSessionId);
    const next = enabled
      ? nextOccurrence(current.cronExpression, current.timezone)
      : null;
    const job = this.#db.setJobEnabled(
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
    const current = this.#db.getJob(id);
    this.#assertModelOwnership(current, actor, sourceSessionId);
    this.#db.deleteJob(id, actor, sourceSessionId);
    return { id, deleted: true };
  }

  async runNow(
    id: string,
    actor: "web" | "model",
    sourceSessionId?: string
  ) {
    const job = this.#db.getJob(id);
    this.#assertModelOwnership(job, actor, sourceSessionId);
    this.#db.audit("schedule.run_now", "success", actor, id, {
      sourceSessionId: sourceSessionId ?? null
    });
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
      return this.list().map((job) => ({
        ...job,
        human: humanizeCron(job.cronExpression, job.timezone)
      }));
    }
    if (action === "get") {
      const job = this.get(jobId);
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

  async #trigger(
    job: ScheduledJob,
    scheduledFor: string,
    triggerType: "cron" | "manual" | "model_run_now"
  ) {
    if (this.#db.activeRunForJob(job.id)) {
      return this.#db.createRun({
        jobId: job.id,
        scheduledFor,
        triggerType,
        status: "skipped_overlap",
        errorSummary: "Previous run is still active"
      });
    }
    const run = this.#db.createRun({
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
      const updated = this.#db.updateRun(run.id, {
        sessionId: session.id,
        startedAt: nowIso()
      });
      const timeout = setTimeout(
        () => void this.#timeoutRun(run.id, session.id),
        job.timeoutSeconds * 1000
      );
      timeout.unref();
      this.#activeTimers.set(run.id, { timeout, grace: null });
      return updated;
    } catch (error) {
      return this.#db.updateRun(run.id, {
        status: "failed",
        endedAt: nowIso(),
        errorSummary: safeErrorMessage(error)
      });
    }
  }

  async #onSessionStatus(session: SessionRecord): Promise<void> {
    if (!session.scheduleRunId) return;
    const run = this.#db.getRun(session.scheduleRunId);
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
    this.#db.updateRun(runId, {
      status,
      endedAt: nowIso(),
      errorSummary: errorSummary ?? null,
      inputTokens: session.inputTokens,
      outputTokens: session.outputTokens,
      reportedCost: session.reportedCost,
      estimatedCost: session.estimatedCost
    });
  }

  async #timeoutRun(runId: string, sessionId: string): Promise<void> {
    const run = this.#db.getRun(runId);
    if (run.status !== "running") return;
    this.#db.updateRun(runId, {
      status: "timed_out",
      endedAt: nowIso(),
      errorSummary: "Run exceeded its timeout"
    });
    await this.#supervisor.abort(sessionId, "scheduler").catch(() => undefined);
    const timers = this.#activeTimers.get(runId);
    if (!timers) return;
    timers.grace = setTimeout(() => {
      void this.#supervisor.close(sessionId, "scheduler").catch(() => undefined);
      this.#activeTimers.delete(runId);
    }, 10_000);
    timers.grace.unref();
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

  #assertModelOwnership(
    job: ScheduledJob,
    actor: "web" | "model",
    sourceSessionId?: string
  ): void {
    if (actor !== "model") return;
    if (this.#config.modelSchedulePolicy === "deny") {
      throw new PiWebError("MODEL_SCHEDULING_DENIED", "Model scheduling is disabled", 403);
    }
    if (
      job.createdBy === "model" &&
      job.createdFromSessionId &&
      job.createdFromSessionId !== sourceSessionId
    ) {
      throw new PiWebError(
        "MODEL_JOB_SCOPE",
        "A model may only modify schedules created from this session",
        403
      );
    }
  }
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
