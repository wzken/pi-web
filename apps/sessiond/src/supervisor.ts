import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import type { PiWebConfig, PiWebPaths } from "@pi-web/config";
import { PiRpcWorker } from "@pi-web/pi-rpc";
import {
  PiSessionCursorError,
  readPiSession
} from "@pi-web/pi-session-reader";
import {
  maxPromptRequestBytes,
  type PiMessage,
  type PromptImage,
  type RealtimeEvent,
  type SessionRecord,
  type SessionSnapshot,
  type SessionTreeSnapshot,
  type SessionStatus,
  type ThinkingLevel,
  type UsageSummary
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
import { TransientMutationDeduper } from "./mutation-deduper.js";
import { fingerprintMutationPayload } from "./mutation-fingerprint.js";
import { RunningSessionProjection } from "./running-session-projection.js";

interface WorkerRuntime {
  worker: PiRpcWorker;
  closeRequested: boolean;
  token: string;
  projection: RunningSessionProjection;
  activityGeneration: number;
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
  mutationId?: string;
}

export class SessionSupervisor extends EventEmitter {
  readonly #db: SessionDatabase;
  #config: PiWebConfig;
  readonly #paths: PiWebPaths;
  readonly #workers = new Map<string, WorkerRuntime>();
  readonly #workerTokens = new Map<string, string>();
  readonly #sessionStarts = new Map<string, Promise<SessionRecord>>();
  readonly #resumeInputQueues = new Map<string, Promise<void>>();
  readonly #backgroundTasks = new Set<Promise<void>>();
  #workerSlotReservations = 0;
  #closing = false;
  #shutdownPromise: Promise<void> | null = null;
  readonly #events: SessionEventBuffer;
  readonly #mutations = new TransientMutationDeduper();

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
    this.#assertAcceptingStarts();
    const { mutationId, ...mutationPayload } = input;
    const mutationFingerprint = mutationId
      ? fingerprintMutationPayload(mutationPayload)
      : undefined;
    if (input.mutationId) {
      const existing = this.#db.findCreateMutation(
        input.mutationId
      );
      if (existing) {
        assertMutationFingerprint(
          existing.fingerprint,
          mutationFingerprint
        );
        if (existing.completed) return existing.session;
        return await this.#recoverIncompleteCreate(
          input,
          mutationFingerprint!
        );
      }
    }
    const cwd = await resolveAllowedDirectory(
      input.cwd,
      this.#config.allowedRoots,
      this.#config.allowAnyDirectory
    );
    const releaseSlot = this.#reserveWorkerSlot();
    let reservationTransferred = false;
    try {
      const result = this.#db.createOrReuseSession({
        ...input,
        ...(mutationFingerprint === undefined
          ? {}
          : { mutationFingerprint }),
        cwd,
        model: input.model ?? this.#config.defaultModel,
        thinkingLevel:
          input.thinkingLevel ?? this.#config.defaultThinkingLevel,
        systemPrompt:
          input.systemPrompt === undefined
            ? this.#config.defaultSystemPrompt
            : input.systemPrompt
      });
      if (!result.created) {
        releaseSlot();
        if (
          input.mutationId &&
          mutationFingerprint &&
          !result.mutationCompleted
        ) {
          return await this.#recoverIncompleteCreate(
            input,
            mutationFingerprint
          );
        }
        return result.session;
      }
      const session = result.session;
      const admission = this.#beginSessionStart(
        session.id,
        async () =>
          await this.#startWithReservation(
            session,
            input.prompt,
            input.images,
            input.mutationId,
            releaseSlot
          )
      );
      if (admission.started) reservationTransferred = true;
      else releaseSlot();
      if (input.mutationId) return await admission.promise;
      void admission.promise.catch(() => undefined);
      return session;
    } finally {
      if (!reservationTransferred) releaseSlot();
    }
  }

  async #recoverIncompleteCreate(
    input: CreateSessionInput,
    mutationFingerprint: string
  ): Promise<SessionRecord> {
    const mutationId = input.mutationId!;
    return await this.#mutations.run(
      `create:${mutationId}`,
      mutationFingerprint,
      async () => {
        const currentMutation = this.#db.findCreateMutation(mutationId);
        if (!currentMutation) {
          throw new PiWebError(
            "CREATE_MUTATION_NOT_FOUND",
            "Create mutation could not be recovered",
            500
          );
        }
        if (currentMutation.completed) return currentMutation.session;
        const pending = this.#sessionStarts.get(currentMutation.session.id);
        if (pending) {
          const recovered = await pending;
          if (this.#db.findCreateMutation(mutationId)?.completed) {
            return recovered;
          }
          throw createMutationPendingError();
        }
        if (this.#workers.has(currentMutation.session.id)) {
          throw createMutationPendingError();
        }
        const admission = this.#beginSessionStart(
          currentMutation.session.id,
          async () => {
            const releaseSlot = this.#reserveWorkerSlot();
            try {
              await resolveAllowedDirectory(
                currentMutation.session.cwd,
                this.#config.allowedRoots,
                this.#config.allowAnyDirectory
              );
              const latest = this.#db.findCreateMutation(mutationId);
              if (!latest) {
                throw new PiWebError(
                  "CREATE_MUTATION_NOT_FOUND",
                  "Create mutation could not be recovered",
                  500
                );
              }
              if (latest.completed) return latest.session;
              if (this.#workers.has(latest.session.id)) {
                throw createMutationPendingError();
              }
              const starting = this.#setStatus(
                latest.session.id,
                "starting",
                {
                  workerPid: null,
                  settledAt: null,
                  endedAt: null,
                  exitCode: null,
                  interruptionReason: null
                }
              );
              return await this.#startWithReservation(
                starting,
                input.prompt,
                input.images,
                mutationId,
                releaseSlot
              );
            } finally {
              releaseSlot();
            }
          }
        );
        const recovered = await admission.promise;
        if (this.#db.findCreateMutation(mutationId)?.completed) {
          return recovered;
        }
        throw createMutationPendingError();
      }
    );
  }

  async resume(
    id: string,
    prompt?: string,
    images: PromptImage[] = [],
    mutationId?: string
  ): Promise<SessionRecord> {
    this.#assertAcceptingStarts();
    if (!mutationId) return await this.#resume(id, prompt, images);
    return await this.#mutations.run(
      `resume:${id}:${mutationId}`,
      fingerprintMutationPayload({ prompt, images }),
      async () => await this.#resume(id, prompt, images)
    );
  }

  async #resume(
    id: string,
    prompt?: string,
    images: PromptImage[] = []
  ): Promise<SessionRecord> {
    const hasInput = Boolean(prompt?.trim()) || images.length > 0;
    const pendingStart = this.#sessionStarts.get(id);
    if (pendingStart) {
      await pendingStart;
      if (hasInput) {
        await this.#queueJoinedResumeInput(
          id,
          prompt?.trim() ?? "",
          images
        );
      }
      return this.#db.getSession(id);
    }
    if (this.#workers.has(id)) {
      if (hasInput) {
        await this.#queueJoinedResumeInput(
          id,
          prompt?.trim() ?? "",
          images
        );
      }
      return this.#db.getSession(id);
    }
    const admission = this.#beginSessionStart(
      id,
      async () => {
        const releaseSlot = this.#reserveWorkerSlot();
        try {
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
          if (this.#workers.has(id)) return this.#db.getSession(id);
          const starting = this.#setStatus(id, "starting", {
            workerPid: null,
            endedAt: null,
            exitCode: null,
            interruptionReason: null
          });
          return await this.#startWithReservation(
            starting,
            prompt,
            images,
            undefined,
            releaseSlot
          );
        } finally {
          releaseSlot();
        }
      }
    );
    await admission.promise;
    if (!admission.started && hasInput) {
      await this.#queueJoinedResumeInput(
        id,
        prompt?.trim() ?? "",
        images
      );
    }
    return this.#db.getSession(id);
  }

  async #queueJoinedResumeInput(
    id: string,
    message: string,
    images: PromptImage[]
  ): Promise<void> {
    this.#assertAcceptingStarts();
    const previous = this.#resumeInputQueues.get(id) ?? Promise.resolve();
    const queued = previous
      .catch(() => undefined)
      .then(async () => {
        const behavior =
          this.#db.getSession(id).status === "waiting"
            ? "prompt"
            : "follow_up";
        await this.#prompt(id, message, behavior, images);
      });
    this.#resumeInputQueues.set(id, queued);
    try {
      await queued;
    } finally {
      if (this.#resumeInputQueues.get(id) === queued) {
        this.#resumeInputQueues.delete(id);
      }
    }
  }

  async prompt(
    id: string,
    message: string,
    behavior: "prompt" | "steer" | "follow_up",
    images: PromptImage[] = [],
    mutationId?: string,
    onAccepted?: () => void
  ): Promise<void> {
    if (!mutationId) {
      await this.#prompt(id, message, behavior, images, onAccepted);
      return;
    }
    await this.#mutations.run(
      `prompt:${id}:${mutationId}`,
      fingerprintMutationPayload({ message, behavior, images }),
      async () =>
        await this.#prompt(
          id,
          message,
          behavior,
          images,
          onAccepted
        )
    );
  }

  async #prompt(
    id: string,
    message: string,
    behavior: "prompt" | "steer" | "follow_up",
    images: PromptImage[] = [],
    onAccepted?: () => void
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
    onAccepted?.();
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
    const state = await runtime.worker.refreshState();
    const updated = this.#reconcileRuntimeSettings(id, state);
    this.#emitEvent(id, "session.model_changed", {
      model: updated.model,
      thinkingLevel: updated.thinkingLevel
    });
  }

  async setThinkingLevel(id: string, thinkingLevel: ThinkingLevel): Promise<void> {
    const runtime = this.#requireRuntime(id);
    await runtime.worker.send({
      type: "set_thinking_level",
      level: thinkingLevel
    });
    const state = await runtime.worker.refreshState();
    const updated = this.#reconcileRuntimeSettings(id, state);
    this.#emitEvent(id, "session.thinking_changed", {
      thinkingLevel: updated.thinkingLevel
    });
  }

  async snapshot(
    id: string,
    cursor?: string | null
  ): Promise<SessionSnapshot> {
    const requireStableBoundary = runtimeHistoryFallbackAllowed(cursor);
    const maxAttempts = requireStableBoundary ? 4 : 1;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const runtime = this.#workers.get(id);
      const boundarySession = this.#db.getSession(id);
      const boundarySequence = this.#currentSequence(
        id,
        boundarySession.lastEventSequence
      );
      let state = runtime?.worker.state ?? null;
      let sessionStats: Record<string, unknown> | null = null;

      if (runtime) {
        try {
          // This RPC is also a persistence barrier: Pi emits message_end before
          // appending that message to JSONL, but it handles the next command
          // only after its event handler has completed the append.
          state = await runtime.worker.refreshState();
          this.#reconcileRuntimeSettings(id, state);
          try {
            const response = await runtime.worker.send({
              type: "get_session_stats"
            });
            const stats = asRecord(response.data);
            sessionStats = stats;
            const usage = usageFromSessionStats(stats);
            if (usage) this.#db.updateUsage(id, usage);
          } catch (error) {
            if (!isUnsupportedPiCommand(error)) throw error;
          }
        } catch (error) {
          if (this.#workers.get(id) === runtime) throw error;
          continue;
        }
      }

      const session = this.#db.getSession(id);
      let messages: PiMessage[] = [];
      let truncated = false;
      let nextCursor: string | null = null;
      let tree: SessionTreeSnapshot | null = null;
      let historyError: unknown = null;
      let historyWarning: string | null = null;
      if (session.piSessionReference) {
        try {
          const read = await readPiSession(session.piSessionReference, {
            limit: 250,
            ...(cursor === undefined ? {} : { cursor })
          });
          messages = read.messages;
          truncated = read.truncated;
          nextCursor = read.nextCursor;
          tree = read.tree;
          this.#db.updateUsage(id, read.usage);
        } catch (error) {
          historyError = error;
        }
      }
      if (!runtimeHistoryFallbackAllowed(cursor)) {
        if (historyError) throw cursorHistoryReadError(historyError);
        if (!session.piSessionReference) {
          throw new PiWebError(
            "PI_SESSION_PAGE_UNAVAILABLE",
            "Pi session history page is unavailable because the session file is missing",
            503
          );
        }
      }
      if ((!session.piSessionReference || historyError) && runtime) {
        try {
          const response = await runtime.worker.send({ type: "get_messages" });
          messages = messagesFromGetMessagesResponse(response.data);
        } catch (error) {
          throw snapshotHistoryError(historyError, error);
        }
        if (historyError) historyWarning = safeErrorMessage(historyError);
      } else if (historyError) {
        throw new PiWebError(
          "PI_SESSION_READ_FAILED",
          `Pi session history is unavailable: ${safeErrorMessage(historyError)}`,
          503
        );
      }

      const projectionRuntime = this.#workers.get(id);
      if (requireStableBoundary && projectionRuntime !== runtime) {
        continue;
      }
      // A snapshot must not expose text that still lacks an event sequence:
      // otherwise the delayed batch arrives after the snapshot and duplicates
      // the same delta in the browser projection.
      const projection =
        projectionRuntime?.projection.synchronizedSnapshot() ?? {
        recentToolEvents: [],
        liveText: "",
        queuedMessages: { steering: [], followUp: [] }
      };
      const refreshed = this.#db.getSession(id);
      const sequence = this.#currentSequence(
        id,
        refreshed.lastEventSequence
      );
      if (requireStableBoundary && sequence !== boundarySequence) {
        continue;
      }
      if (historyWarning) {
        this.#emitEvent(id, "session.snapshot_warning", {
          message: historyWarning
        });
      }
      return {
        session: refreshed,
        messages,
        state,
        sessionStats,
        recentToolEvents: projection.recentToolEvents,
        liveText: projection.liveText,
        queuedMessages: projection.queuedMessages,
        tree,
        sequence,
        truncated,
        nextCursor
      };
    }

    throw new PiWebError(
      "SESSION_SNAPSHOT_BUSY",
      "Pi session changed while its snapshot was being synchronized",
      503
    );
  }

  async sync(
    id: string,
    afterSequence: number
  ): Promise<
    | { mode: "incremental"; events: RealtimeEvent[]; sequence: number }
    | { mode: "snapshot"; snapshot: SessionSnapshot }
  > {
    const replay = this.#events.replay(id, afterSequence);
    const session = this.#db.getSession(id);
    const sequence = this.#currentSequence(
      id,
      session.lastEventSequence
    );
    const replayedThrough =
      replay.events.at(-1)?.sequence ?? afterSequence;
    if (replay.available && replayedThrough === sequence) {
      return {
        mode: "incremental",
        events: replay.events,
        sequence
      };
    }
    return { mode: "snapshot", snapshot: await this.snapshot(id) };
  }

  shutdown(): Promise<void> {
    this.#shutdownPromise ??= this.#shutdown();
    return this.#shutdownPromise;
  }

  async #shutdown(): Promise<void> {
    this.#closing = true;
    await this.#drainLifecycleTasks();
    // Normal sessiond shutdown cannot preserve child ownership. Marking sessions
    // interrupted is honest and prevents false success on restart.
    const closeResults = await Promise.allSettled(
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
        await runtime.worker.close(1000);
      })
    );
    await this.#drainLifecycleTasks();
    const closeFailures = closeResults
      .filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected"
      )
      .map((result) => result.reason);
    if (
      closeFailures.length > 0 ||
      this.#workers.size > 0 ||
      this.#workerSlotReservations > 0
    ) {
      throw new AggregateError(
        closeFailures,
        "Session daemon could not stop every Pi worker"
      );
    }
  }

  #beginSessionStart(
    id: string,
    start: () => Promise<SessionRecord>
  ): { started: boolean; promise: Promise<SessionRecord> } {
    this.#assertAcceptingStarts();
    const existing = this.#sessionStarts.get(id);
    if (existing) return { started: false, promise: existing };
    const tracked = Promise.resolve()
      .then(start)
      .finally(() => {
        if (this.#sessionStarts.get(id) === tracked) {
          this.#sessionStarts.delete(id);
        }
      });
    this.#sessionStarts.set(id, tracked);
    return { started: true, promise: tracked };
  }

  #reserveWorkerSlot(): () => void {
    this.#assertAcceptingStarts();
    if (
      this.#workers.size + this.#workerSlotReservations >=
      this.#config.maxConcurrentWorkers
    ) {
      throw new PiWebError(
        "WORKER_LIMIT",
        `At most ${this.#config.maxConcurrentWorkers} workers may run concurrently`,
        429
      );
    }
    this.#workerSlotReservations += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#workerSlotReservations -= 1;
    };
  }

  async #startWithReservation(
    session: SessionRecord,
    initialPrompt: string | undefined,
    initialImages: PromptImage[] | undefined,
    createMutationId: string | undefined,
    releaseSlot: () => void
  ): Promise<SessionRecord> {
    const startup = this.#start(
      session,
      initialPrompt,
      initialImages,
      createMutationId
    );
    releaseSlot();
    try {
      await startup;
      return this.#db.getSession(session.id);
    } finally {
      releaseSlot();
    }
  }

  async #start(
    session: SessionRecord,
    initialPrompt?: string,
    initialImages: PromptImage[] = [],
    createMutationId?: string
  ): Promise<void> {
    if (this.#workers.has(session.id)) {
      throw new PiWebError(
        "SESSION_ALREADY_ACTIVE",
        "Session already has an active Pi worker",
        409
      );
    }
    let runtime: WorkerRuntime | undefined;
    try {
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
      runtime = {
        worker,
        closeRequested: false,
        token,
        activityGeneration: 0,
        projection: new RunningSessionProjection({
          emitMessageUpdate: (event) =>
            this.#emitEvent(session.id, "pi.message_update", event),
          emitPiEvent: (type, event) =>
            this.#emitEvent(session.id, `pi.${type}`, event)
        })
      };
      this.#workers.set(session.id, runtime);
      this.#workerTokens.set(token, session.id);
      worker.on("event", (event) =>
        this.#onPiEvent(
          session.id,
          runtime!,
          event as Record<string, unknown>
        )
      );
      worker.on("protocolError", (event) =>
        this.#emitEvent(session.id, "pi.protocol_error", event)
      );
      worker.on("stderr", (text: string) =>
        this.emit("log", {
          level: "warn",
          sessionId: session.id,
          message: text.slice(-2000)
        })
      );
      worker.once("exit", (info) =>
        this.#onWorkerExit(
          session.id,
          runtime!,
          info as Record<string, unknown>
        )
      );

      const state = await worker.start();
      if (this.#workers.get(session.id) !== runtime) return;
      const modelRecord = asRecord(state.model);
      const model =
        typeof modelRecord.provider === "string" &&
        typeof modelRecord.id === "string"
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
        pid: worker.pid
      });
      if (initialPrompt?.trim() || initialImages.length > 0) {
        await this.prompt(
          session.id,
          initialPrompt?.trim() ?? "",
          "prompt",
          initialImages,
          undefined,
          createMutationId
            ? () =>
                this.#db.completeCreateMutation(
                  session.id,
                  createMutationId
                )
            : undefined
        );
      } else {
        if (createMutationId) {
          this.#db.completeCreateMutation(session.id, createMutationId);
        }
        this.emit("status", updated);
      }
    } catch (error) {
      await this.#failStartup(session.id, error, runtime);
      throw error;
    }
  }

  #onPiEvent(
    id: string,
    runtime: WorkerRuntime,
    event: Record<string, unknown>
  ): void {
    if (this.#closing || this.#workers.get(id) !== runtime) return;
    const type = runtime.projection.ingest(event);
    if (!type) return;
      if (type === "agent_start" || type === "turn_start") {
      runtime.activityGeneration += 1;
      this.#setStatus(id, "running");
    } else if (type === "agent_settled") {
      this.#trackBackgroundTask(
        this.#settleSession(id, runtime, runtime.activityGeneration)
      );
    } else if (type === "extension_error") {
      this.#emitEvent(id, "session.warning", {
        message: "A Pi extension reported an error",
        detail: safeErrorMessage(
          event.message ?? event.error ?? "Unknown extension error"
        ).slice(0, 2_000),
        extensionPath:
          typeof (event.extensionPath ?? event.path) === "string"
            ? String(event.extensionPath ?? event.path).slice(0, 2_000)
            : null
      });
    }
  }

  async #refreshUsage(
    id: string,
    runtime: WorkerRuntime,
    activityGeneration: number
  ): Promise<void> {
    try {
      const response = await runtime.worker.send({
        type: "get_session_stats"
      });
      if (!this.#runtimeGenerationMatches(id, runtime, activityGeneration)) {
        return;
      }
      const usage = usageFromSessionStats(response.data);
      if (usage) {
        const updated = this.#db.updateUsage(id, usage);
        this.emit("status", updated);
        return;
      }
    } catch (error) {
      if (!isUnsupportedPiCommand(error)) {
        this.emit("log", {
          level: "warn",
          sessionId: id,
          message: `Pi session stats unavailable: ${safeErrorMessage(error)}`
        });
      }
    }
    if (!this.#runtimeGenerationMatches(id, runtime, activityGeneration)) {
      return;
    }
    const session = this.#db.getSession(id);
    if (!session.piSessionReference) return;
    const retryDelays = [0, 25, 75, 150, 300];
    let lastError: unknown = null;
    for (const delay of retryDelays) {
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      if (!this.#runtimeGenerationMatches(id, runtime, activityGeneration)) {
        return;
      }
      try {
        const read = await readPiSession(session.piSessionReference, {
          limit: 1
        });
        if (!this.#runtimeGenerationMatches(id, runtime, activityGeneration)) {
          return;
        }
        const updated = this.#db.updateUsage(id, read.usage);
        this.emit("status", updated);
        return;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) {
      this.#emitEvent(id, "session.usage_warning", {
        message: safeErrorMessage(lastError)
      });
    }
  }

  async #settleSession(
    id: string,
    runtime: WorkerRuntime,
    activityGeneration: number
  ): Promise<void> {
    await this.#refreshUsage(id, runtime, activityGeneration);
    if (!this.#runtimeGenerationMatches(id, runtime, activityGeneration)) {
      return;
    }
    const current = this.#db.getSession(id);
    if (current.status === "running" || current.status === "stopping") {
      this.#setStatus(id, "waiting", { settledAt: nowIso() });
    }
  }

  #onWorkerExit(
    id: string,
    runtime: WorkerRuntime,
    info: Record<string, unknown>
  ): void {
    runtime.projection.flush();
    this.#workerTokens.delete(runtime.token);
    if (this.#workers.get(id) !== runtime) return;
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

  async #failStartup(
    id: string,
    error: unknown,
    expectedRuntime?: WorkerRuntime
  ): Promise<void> {
    const runtime = this.#workers.get(id);
    if (expectedRuntime && runtime !== expectedRuntime) {
      expectedRuntime.projection.flush();
      this.#workerTokens.delete(expectedRuntime.token);
      await expectedRuntime.worker.close(1000);
      if (runtime) return;
    }
    if (runtime) {
      runtime.projection.flush();
      this.#workerTokens.delete(runtime.token);
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
    if (runtime) {
      await runtime.worker.close(1000);
    }
  }

  #trackBackgroundTask(task: Promise<void>): void {
    this.#backgroundTasks.add(task);
    void task
      .finally(() => this.#backgroundTasks.delete(task))
      .catch(() => undefined);
  }

  async #drainLifecycleTasks(): Promise<void> {
    while (
      this.#sessionStarts.size > 0 ||
      this.#resumeInputQueues.size > 0 ||
      this.#backgroundTasks.size > 0
    ) {
      await Promise.allSettled([
        ...this.#sessionStarts.values(),
        ...this.#resumeInputQueues.values(),
        ...this.#backgroundTasks
      ]);
    }
  }

  #assertAcceptingStarts(): void {
    if (this.#closing) {
      throw new PiWebError(
        "SESSIOND_STOPPING",
        "Session daemon is stopping",
        503
      );
    }
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
    const eviction = this.#events.append(event);
    if (eviction) {
      const evictedSession = this.#db.getSession(eviction.sessionId);
      if (evictedSession.lastEventSequence < eviction.latestSequence) {
        this.#db.updateSession(eviction.sessionId, {
          lastEventSequence: eviction.latestSequence
        });
      }
    }
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

  #runtimeGenerationMatches(
    id: string,
    runtime: WorkerRuntime,
    activityGeneration: number
  ): boolean {
    return runtimeGenerationIsCurrent(
      this.#workers.get(id),
      runtime,
      runtime.activityGeneration,
      activityGeneration
    );
  }

  #reconcileRuntimeSettings(
    id: string,
    state: Record<string, unknown>
  ): SessionRecord {
    const current = this.#db.getSession(id);
    const modelRecord = asRecord(state.model);
    const model =
      typeof modelRecord.provider === "string" &&
      typeof modelRecord.id === "string"
        ? `${modelRecord.provider}/${modelRecord.id}`
        : state.model === null
          ? null
          : current.model;
    const thinkingLevel =
      typeof state.thinkingLevel === "string"
        ? (state.thinkingLevel as ThinkingLevel)
        : current.thinkingLevel;
    if (
      model === current.model &&
      thinkingLevel === current.thinkingLevel
    ) {
      return current;
    }
    return this.#db.updateSession(id, { model, thinkingLevel });
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export function messagesFromGetMessagesResponse(value: unknown): PiMessage[] {
  const messages = asRecord(value).messages;
  if (!Array.isArray(messages)) {
    throw new PiWebError(
      "PI_RPC_INVALID_RESPONSE",
      "Pi get_messages returned an invalid messages payload",
      502
    );
  }
  return messages as PiMessage[];
}

export function runtimeGenerationIsCurrent<T extends object>(
  currentRuntime: T | undefined,
  expectedRuntime: T,
  currentGeneration: number,
  expectedGeneration: number
): boolean {
  return (
    currentRuntime === expectedRuntime &&
    currentGeneration === expectedGeneration
  );
}

export function runtimeHistoryFallbackAllowed(
  cursor?: string | null
): boolean {
  return cursor === undefined || cursor === null;
}

export function cursorHistoryReadError(error: unknown): PiWebError {
  const stale = error instanceof PiSessionCursorError;
  return new PiWebError(
    stale ? "PI_SESSION_CURSOR_STALE" : "PI_SESSION_PAGE_UNAVAILABLE",
    stale
      ? `Pi session history changed; reload the latest page: ${safeErrorMessage(error)}`
      : `Pi session history page is unavailable: ${safeErrorMessage(error)}`,
    stale ? 409 : 503
  );
}

export function snapshotHistoryError(
  historyError: unknown,
  fallbackError: unknown
): PiWebError {
  const fallbackMessage = safeErrorMessage(fallbackError);
  const historyMessage =
    historyError === null || historyError === undefined
      ? null
      : safeErrorMessage(historyError);
  return new PiWebError(
    "PI_SESSION_READ_FAILED",
    historyMessage
      ? `Pi session history is unavailable (${historyMessage}); RPC fallback failed: ${fallbackMessage}`
      : `Pi session history RPC failed: ${fallbackMessage}`,
    503,
    {
      historyError: historyMessage,
      fallbackError: fallbackMessage
    }
  );
}

export function usageFromSessionStats(value: unknown): UsageSummary | null {
  const stats = asRecord(value);
  const tokens = asRecord(stats.tokens);
  const inputTokens = finiteNumber(tokens.input);
  const outputTokens = finiteNumber(tokens.output);
  const cachedTokens = finiteNumber(tokens.cacheRead);
  const toolCalls = finiteNumber(stats.toolCalls);
  if (
    inputTokens === null ||
    outputTokens === null ||
    cachedTokens === null ||
    toolCalls === null
  ) {
    return null;
  }
  const reportedCost = finiteNumber(stats.cost);
  return {
    inputTokens,
    outputTokens,
    cachedTokens,
    reportedCost,
    estimatedCost: null,
    costStatus: reportedCost === null ? "unknown" : "reported",
    toolCalls
  };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function assertMutationFingerprint(
  existing: string | null,
  incoming: string | undefined
): void {
  if (existing !== null && existing === incoming) return;
  throw new PiWebError(
    "MUTATION_ID_REUSED",
    "Mutation ID was already used for a different payload",
    409
  );
}

function createMutationPendingError(): PiWebError {
  return new PiWebError(
    "CREATE_MUTATION_PENDING",
    "Create mutation is still being accepted",
    503
  );
}

export function isUnsupportedPiCommand(error: unknown): boolean {
  return (
    error instanceof PiWebError &&
    error.code === "PI_RPC_REJECTED" &&
    /unknown|unsupported|not implemented/i.test(error.message)
  );
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
