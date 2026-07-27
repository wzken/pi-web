import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import type { PiWebConfig, PiWebPaths } from "@pi-web/config";
import { PiRpcWorker } from "@pi-web/pi-rpc";
import { readPiSession } from "@pi-web/pi-session-reader";
import {
  maxPromptRequestBytes,
  type PiMessage,
  type PromptImage,
  type QueuedMessages,
  type RealtimeEvent,
  type SessionRecord,
  type SessionSnapshot,
  type SessionTreeSnapshot,
  type SessionStatus,
  type ThinkingLevel
} from "@pi-web/protocol";
import {
  assertTransition,
  generateSessionToken,
  nowIso,
  PiWebError,
  resolveAllowedDirectory,
  safeErrorMessage
} from "@pi-web/shared";
import { SessionDatabase } from "./database.js";
import { SessionEventBuffer } from "./event-buffer.js";
import { MessageUpdateBatch } from "./message-update-batch.js";

interface WorkerRuntime {
  worker: PiRpcWorker;
  closeRequested: boolean;
  token: string;
  messageUpdates: MessageUpdateBatch;
  recentToolEvents: RealtimeEvent[];
  queuedMessages: QueuedMessages;
}

export interface CreateSessionInput {
  cwd: string;
  displayName: string;
  prompt?: string;
  images?: PromptImage[];
  model?: string | null;
  thinkingLevel?: ThinkingLevel | null;
  systemPrompt?: string | null;
  createdBy: "web" | "cron" | "model";
  scheduleRunId?: string | null;
  piSessionReference?: string | null;
}

export class SessionSupervisor extends EventEmitter {
  readonly #db: SessionDatabase;
  #config: PiWebConfig;
  readonly #paths: PiWebPaths;
  readonly #workers = new Map<string, WorkerRuntime>();
  readonly #workerTokens = new Map<string, string>();
  readonly #events: SessionEventBuffer;

  constructor(db: SessionDatabase, config: PiWebConfig, paths: PiWebPaths) {
    super();
    this.#db = db;
    this.#config = config;
    this.#paths = paths;
    this.#events = new SessionEventBuffer(config.eventBufferSize);
  }

  updateConfig(config: PiWebConfig): void {
    this.#config = config;
  }

  get activeCount(): number {
    return this.#workers.size;
  }

  getWorkerSessionForToken(token: string): string | null {
    return this.#workerTokens.get(token) ?? null;
  }

  list(): SessionRecord[] {
    return this.#db.listSessions();
  }

  get(id: string): SessionRecord {
    return this.#db.getSession(id);
  }

  async rename(
    id: string,
    displayName: string,
    actor = "web"
  ): Promise<SessionRecord> {
    const current = this.#db.getSession(id);
    const runtime = this.#workers.get(id);
    if (runtime) {
      try {
        await runtime.worker.send({ type: "set_session_name", name: displayName });
      } catch (error) {
        this.#emitEvent(id, "session.warning", {
          message:
            "Pi 当前版本未接受会话重命名；网页中的名称仍会保存。",
          detail: safeErrorMessage(error)
        });
      }
    }
    if (current.displayName === displayName) return current;
    const updated = this.#db.renameSession(id, displayName, actor);
    this.#emitEvent(id, "session.renamed", { displayName });
    return updated;
  }

  async create(input: CreateSessionInput): Promise<SessionRecord> {
    if (this.#workers.size >= this.#config.maxConcurrentWorkers) {
      throw new PiWebError(
        "WORKER_LIMIT",
        `At most ${this.#config.maxConcurrentWorkers} workers may run concurrently`,
        429
      );
    }
    const cwd = await resolveAllowedDirectory(
      input.cwd,
      this.#config.allowedRoots,
      this.#config.allowAnyDirectory
    );
    const session = this.#db.createSession({
      ...input,
      cwd,
      model: input.model ?? this.#config.defaultModel,
      thinkingLevel:
        input.thinkingLevel ?? this.#config.defaultThinkingLevel,
      systemPrompt:
        input.systemPrompt === undefined
          ? this.#config.defaultSystemPrompt
          : input.systemPrompt
    });
    void this.#start(session, input.prompt, input.images).catch((error) => {
      this.#failStartup(session.id, error);
    });
    return session;
  }

  async resume(
    id: string,
    prompt?: string,
    images: PromptImage[] = []
  ): Promise<SessionRecord> {
    if (this.#workers.has(id)) return this.#db.getSession(id);
    if (this.#workers.size >= this.#config.maxConcurrentWorkers) {
      throw new PiWebError("WORKER_LIMIT", "Concurrent worker limit reached", 429);
    }
    const session = this.#db.getSession(id);
    if (!session.piSessionReference) {
      throw new PiWebError(
        "SESSION_NOT_PERSISTED",
        "This session has no Pi session file to resume",
        409
      );
    }
    await resolveAllowedDirectory(
      session.cwd,
      this.#config.allowedRoots,
      this.#config.allowAnyDirectory
    );
    const starting = this.#setStatus(id, "starting", {
      workerPid: null,
      endedAt: null,
      exitCode: null,
      interruptionReason: null
    });
    void this.#start(starting, prompt, images).catch((error) => {
      this.#failStartup(id, error);
    });
    return starting;
  }

  async prompt(
    id: string,
    message: string,
    behavior: "prompt" | "steer" | "follow_up",
    images: PromptImage[] = []
  ): Promise<void> {
    const runtime = this.#workers.get(id);
    if (!runtime) {
      throw new PiWebError(
        "SESSION_NOT_ACTIVE",
        "Resume the session before sending a message",
        409
      );
    }
    const current = this.#db.getSession(id);
    if (behavior === "prompt" && current.status !== "waiting") {
      throw new PiWebError(
        "SESSION_BUSY",
        "Use steer or follow-up while the session is running",
        409
      );
    }
    await runtime.worker.prompt(message, behavior, images);
    const latest = this.#db.getSession(id);
    if (latest.status === "waiting") {
      this.#setStatus(id, "running");
    }
    this.#emitEvent(id, "input.accepted", {
      behavior,
      imageCount: images.length
    });
  }

  async abort(id: string, actor = "web"): Promise<void> {
    const runtime = this.#workers.get(id);
    if (!runtime) throw new PiWebError("SESSION_NOT_ACTIVE", "Session is not active", 409);
    await runtime.worker.abort();
    const latest = this.#db.getSession(id);
    if (latest.status === "running") {
      this.#setStatus(id, "stopping");
    }
    this.#emitEvent(id, "session.abort_requested", {});
    this.#db.audit("session.stop", "success", actor, id);
  }

  async close(id: string, actor = "web"): Promise<void> {
    const runtime = this.#workers.get(id);
    if (!runtime) {
      const current = this.#db.getSession(id);
      if (current.status !== "closed") {
        this.#setStatus(id, "closed", { endedAt: nowIso() });
        this.#db.audit("session.close", "success", actor, id);
      }
      return;
    }
    runtime.closeRequested = true;
    this.#setStatus(id, "stopping");
    await runtime.worker.close();
    this.#db.audit("session.close", "success", actor, id);
  }

  async setModel(id: string, model: string): Promise<void> {
    const runtime = this.#requireRuntime(id);
    const slash = model.indexOf("/");
    if (slash <= 0 || slash === model.length - 1) {
      throw new PiWebError("INVALID_MODEL", "Model must be provider/model-id", 400);
    }
    await runtime.worker.send({
      type: "set_model",
      provider: model.slice(0, slash),
      modelId: model.slice(slash + 1)
    });
    this.#db.updateSession(id, { model });
    this.#emitEvent(id, "session.model_changed", { model });
  }

  async setThinkingLevel(id: string, thinkingLevel: ThinkingLevel): Promise<void> {
    const runtime = this.#requireRuntime(id);
    await runtime.worker.send({
      type: "set_thinking_level",
      level: thinkingLevel
    });
    this.#db.updateSession(id, { thinkingLevel });
    this.#emitEvent(id, "session.thinking_changed", { thinkingLevel });
  }

  async snapshot(
    id: string,
    cursor?: string | null
  ): Promise<SessionSnapshot> {
    const session = this.#db.getSession(id);
    const runtime = this.#workers.get(id);
    let messages: PiMessage[] = [];
    let entries: unknown[] = [];
    let truncated = false;
    let nextCursor: string | null = null;
    let tree: SessionTreeSnapshot | null = null;
    let state = runtime?.worker.state ?? null;
    if (session.piSessionReference) {
      try {
        const read = await readPiSession(session.piSessionReference, {
          limit: 250,
          ...(cursor === undefined ? {} : { cursor })
        });
        messages = read.messages;
        entries = read.entries;
        truncated = read.truncated;
        nextCursor = read.nextCursor;
        tree = read.tree;
        this.#db.updateUsage(id, read.usage);
      } catch (error) {
        this.#emitEvent(id, "session.snapshot_warning", {
          message: safeErrorMessage(error)
        });
      }
    } else if (runtime) {
      try {
        const response = await runtime.worker.send({ type: "get_messages" });
        const data = asRecord(response.data);
        messages = Array.isArray(data.messages) ? (data.messages as PiMessage[]) : [];
      } catch {
        // The session row and event stream still provide a useful snapshot.
      }
    }
    if (runtime) {
      state = await runtime.worker.refreshState().catch(() => state);
      try {
        const response = await runtime.worker.send({ type: "get_session_stats" });
        state = {
          ...asRecord(state),
          sessionStats: asRecord(response.data)
        };
      } catch {
        // Older Pi versions may not expose session statistics. Keep the
        // otherwise valid state snapshot and let the UI show an unknown value.
      }
      state = {
        ...asRecord(state),
        recentToolEvents: runtime.recentToolEvents,
        queuedMessages: runtime.queuedMessages
      };
    }
    const refreshed = this.#db.getSession(id);
    return {
      session: refreshed,
      messages,
      entries,
      state,
      queuedMessages: runtime?.queuedMessages ?? {
        steering: [],
        followUp: []
      },
      tree,
      sequence: this.#currentSequence(id, refreshed.lastEventSequence),
      truncated,
      nextCursor
    };
  }

  async sync(
    id: string,
    afterSequence: number
  ): Promise<
    | { mode: "incremental"; events: RealtimeEvent[]; sequence: number }
    | { mode: "snapshot"; snapshot: SessionSnapshot }
  > {
    const replay = this.#events.replay(id, afterSequence);
    if (replay.available) {
      const session = this.#db.getSession(id);
      return {
        mode: "incremental",
        events: replay.events,
        sequence: this.#currentSequence(id, session.lastEventSequence)
      };
    }
    return { mode: "snapshot", snapshot: await this.snapshot(id) };
  }

  async shutdown(): Promise<void> {
    // Normal sessiond shutdown cannot preserve child ownership. Marking sessions
    // interrupted is honest and prevents false success on restart.
    await Promise.all(
      [...this.#workers.entries()].map(async ([id, runtime]) => {
        runtime.closeRequested = false;
        const row = this.#db.getSession(id);
        if (!["closed", "failed", "interrupted"].includes(row.status)) {
          this.#setStatus(id, "interrupted", {
            workerPid: null,
            endedAt: nowIso(),
            interruptionReason: "session daemon stopped"
          });
        }
        await runtime.worker.close(1000).catch(() => undefined);
      })
    );
  }

  async #start(
    session: SessionRecord,
    initialPrompt?: string,
    initialImages: PromptImage[] = []
  ): Promise<void> {
    const token = generateSessionToken();
    const fakePath = process.env.PI_WEB_FAKE_PI;
    const extensionPath =
      process.env.PI_WEB_SCHEDULER_EXTENSION ||
      fileURLToPath(import.meta.resolve("@pi-web/scheduler-extension"));
    const worker = new PiRpcWorker({
      executable: fakePath ? process.execPath : this.#config.piExecutable,
      ...(fakePath ? { prefixArgs: [fakePath] } : {}),
      cwd: session.cwd,
      name: session.displayName,
      sessionPath: session.piSessionReference,
      model: session.model,
      thinkingLevel: session.thinkingLevel,
      systemPrompt: session.systemPrompt,
      extensionPath,
      maxLineBytes: maxPromptRequestBytes,
      env: {
        PI_WEB_SCHEDULER_SOCKET: this.#paths.socketPath,
        PI_WEB_SCHEDULER_TOKEN: token,
        PI_WEB_SESSION_ID: session.id
      }
    });
    const runtime: WorkerRuntime = {
      worker,
      closeRequested: false,
      token,
      messageUpdates: new MessageUpdateBatch((event) =>
        this.#emitEvent(session.id, "pi.message_update", event)
      ),
      recentToolEvents: [],
      queuedMessages: { steering: [], followUp: [] }
    };
    this.#workers.set(session.id, runtime);
    this.#workerTokens.set(token, session.id);
    worker.on("event", (event) => this.#onPiEvent(session.id, event as Record<string, unknown>));
    worker.on("protocolError", (event) =>
      this.#emitEvent(session.id, "pi.protocol_error", event)
    );
    worker.on("stderr", (text: string) =>
      this.emit("log", { level: "warn", sessionId: session.id, message: text.slice(-2000) })
    );
    worker.once("exit", (info) => this.#onWorkerExit(session.id, info as Record<string, unknown>));

    const state = await worker.start();
    const modelRecord = asRecord(state.model);
    const model =
      typeof modelRecord.provider === "string" && typeof modelRecord.id === "string"
        ? `${modelRecord.provider}/${modelRecord.id}`
        : session.model;
    const thinking =
      typeof state.thinkingLevel === "string"
        ? (state.thinkingLevel as ThinkingLevel)
        : session.thinkingLevel;
    const updated = this.#db.updateSession(session.id, {
      status: "waiting",
      workerPid: worker.pid,
      piSessionReference:
        typeof state.sessionFile === "string"
          ? state.sessionFile
          : session.piSessionReference,
      model,
      thinkingLevel: thinking
    });
    this.#emitEvent(session.id, "session.ready", {
      pid: worker.pid,
      state
    });
    if (initialPrompt?.trim() || initialImages.length > 0) {
      await this.prompt(
        session.id,
        initialPrompt?.trim() ?? "",
        "prompt",
        initialImages
      );
    } else {
      this.emit("status", updated);
    }
  }

  #onPiEvent(id: string, event: Record<string, unknown>): void {
    const runtime = this.#workers.get(id);
    if (!runtime) return;
    const type = typeof event.type === "string" ? event.type : "unknown";
    if (type === "message_update") {
      runtime.messageUpdates.push(event);
      return;
    }

    runtime.messageUpdates.flush();
    if (type === "queue_update") {
      runtime.queuedMessages = normalizeQueuedMessages(event);
    }
    const emitted = this.#emitEvent(id, `pi.${type}`, event);
    if (type.startsWith("tool_execution_")) {
      runtime.recentToolEvents.push(emitted);
      runtime.recentToolEvents = runtime.recentToolEvents.slice(-50);
    }
    if (type === "agent_start" || type === "turn_start") {
      this.#setStatus(id, "running");
    } else if (type === "agent_settled") {
      void this.#settleSession(id);
    } else if (type === "extension_error") {
      this.#emitEvent(id, "session.warning", {
        message: "A Pi extension reported an error",
        event
      });
    }
  }

  async #refreshUsage(id: string): Promise<void> {
    const session = this.#db.getSession(id);
    if (!session.piSessionReference) return;
    try {
      const read = await readPiSession(session.piSessionReference, { limit: 1 });
      const updated = this.#db.updateUsage(id, read.usage);
      this.emit("status", updated);
    } catch {
      // Session persistence can lag the settled event briefly; next snapshot
      // will refresh the aggregate.
    }
  }

  async #settleSession(id: string): Promise<void> {
    await this.#refreshUsage(id);
    const current = this.#db.getSession(id);
    if (current.status === "running" || current.status === "stopping") {
      this.#setStatus(id, "waiting", { settledAt: nowIso() });
    }
  }

  #onWorkerExit(id: string, info: Record<string, unknown>): void {
    const runtime = this.#workers.get(id);
    if (!runtime) return;
    runtime.messageUpdates.flush();
    this.#workerTokens.delete(runtime.token);
    this.#workers.delete(id);
    const current = this.#db.getSession(id);
    const code = typeof info.code === "number" ? info.code : null;
    if (runtime.closeRequested) {
      this.#setStatus(id, "closed", {
        workerPid: null,
        endedAt: nowIso(),
        exitCode: code
      });
    } else if (!["failed", "interrupted", "closed"].includes(current.status)) {
      this.#setStatus(id, "interrupted", {
        workerPid: null,
        endedAt: nowIso(),
        exitCode: code,
        interruptionReason: "Pi RPC worker exited unexpectedly"
      });
      this.#db.audit("session.interrupted", "failure", "system", id, {
        exitCode: code
      });
    }
    this.#emitEvent(id, "session.worker_exit", {
      code,
      signal: info.signal ?? null,
      intentional: runtime.closeRequested
    });
  }

  #failStartup(id: string, error: unknown): void {
    const runtime = this.#workers.get(id);
    if (runtime) {
      runtime.messageUpdates.flush();
      this.#workerTokens.delete(runtime.token);
      this.#workers.delete(id);
      void runtime.worker.close(1000).catch(() => undefined);
    }
    const message = safeErrorMessage(error);
    const failed = this.#db.updateSession(id, {
      status: "failed",
      workerPid: null,
      endedAt: nowIso(),
      interruptionReason: message
    });
    this.#emitEvent(id, "session.start_failed", { message });
    this.#db.audit("session.failed", "failure", "system", id, { message });
    this.emit("status", failed);
  }

  #setStatus(
    id: string,
    status: SessionStatus,
    patch: Partial<SessionRecord> = {}
  ): SessionRecord {
    const current = this.#db.getSession(id);
    assertTransition(current.status, status);
    const updated = this.#db.updateSession(id, {
      status,
      ...pickSessionPatch(patch)
    });
    if (current.status !== status) {
      this.#emitEvent(id, "session.status", { status });
      this.emit("status", updated);
    }
    return updated;
  }

  #emitEvent(id: string, type: string, payload: unknown): RealtimeEvent {
    const current = this.#db.getSession(id);
    const sequence = this.#currentSequence(id, current.lastEventSequence) + 1;
    const event: RealtimeEvent = {
      sessionId: id,
      sequence,
      type,
      timestamp: nowIso(),
      payload
    };
    this.#events.append(event);
    if (sequence % 25 === 0 || !type.endsWith("message_update")) {
      this.#db.updateSession(id, { lastEventSequence: sequence });
    }
    this.emit("event", event);
    return event;
  }

  #currentSequence(id: string, persisted: number): number {
    return Math.max(persisted, this.#events.latestSequence(id));
  }

  #requireRuntime(id: string): WorkerRuntime {
    const runtime = this.#workers.get(id);
    if (!runtime) throw new PiWebError("SESSION_NOT_ACTIVE", "Session is not active", 409);
    return runtime;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeQueuedMessages(value: unknown): QueuedMessages {
  const record = asRecord(value);
  return {
    steering: stringArray(record.steering),
    followUp: stringArray(record.followUp)
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function pickSessionPatch(
  patch: Partial<SessionRecord>
): Partial<
  Pick<
    SessionRecord,
    | "workerPid"
    | "settledAt"
    | "endedAt"
    | "exitCode"
    | "interruptionReason"
  >
> {
  const result: Partial<
    Pick<
      SessionRecord,
      "workerPid" | "settledAt" | "endedAt" | "exitCode" | "interruptionReason"
    >
  > = {};
  if ("workerPid" in patch) result.workerPid = patch.workerPid ?? null;
  if ("settledAt" in patch) result.settledAt = patch.settledAt ?? null;
  if ("endedAt" in patch) result.endedAt = patch.endedAt ?? null;
  if ("exitCode" in patch) result.exitCode = patch.exitCode ?? null;
  if ("interruptionReason" in patch) {
    result.interruptionReason = patch.interruptionReason ?? null;
  }
  return result;
}
