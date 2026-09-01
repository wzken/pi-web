import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { rename, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { PiWebConfig, PiWebPaths } from "@pi-web/config";
import { PiRpcWorker } from "@pi-web/pi-rpc";
import {
  clearSessionCache,
  readPiSession
} from "@pi-web/pi-session-reader";
import {
  maxPromptRequestBytes,
  type ExtensionUiResponse,
  type PromptImage,
  type RealtimeEvent,
  type SessionListPage,
  type SessionRecord,
  type SessionSnapshot,
  type SessionStatus,
  type SessionSyncResult,
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
import { ExtensionInteractions } from "./extension-interactions.js";
import {
  isUnsupportedPiCommand,
  SessionHistory,
  usageFromSessionStats
} from "./session-history.js";
import { TransientMutationDeduper } from "./mutation-deduper.js";
import { fingerprintMutationPayload } from "./mutation-fingerprint.js";
import { NotificationCenter } from "./notification-center.js";
import { RunningSessionProjection } from "./running-session-projection.js";
import {
  RuntimeRegistry,
  type WorkerRuntime
} from "./runtime-registry.js";
import { SessionStore } from "./session-store.js";
import { assertPiCompatible } from "./pi-compatibility.js";

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

type Transaction = <T>(operation: () => T) => T;
type AuditWriter = (
  type: string,
  outcome: "success" | "failure",
  actor: string,
  subjectId?: string | null,
  metadata?: Record<string, unknown>
) => void;

export class SessionSupervisor extends EventEmitter {
  readonly #sessions: SessionStore;
  readonly #transaction: Transaction;
  readonly #audit: AuditWriter;
  #config: PiWebConfig;
  readonly #paths: PiWebPaths;
  readonly #runtime = new RuntimeRegistry();
  #drainingReason: "service" | "package" | null = null;
  #closing = false;
  #shutdownPromise: Promise<void> | null = null;
  readonly #history: SessionHistory;
  readonly #extensionInteractions: ExtensionInteractions;
  readonly #notifications: NotificationCenter;
  readonly #mutations = new TransientMutationDeduper();

  constructor(
    sessions: SessionStore,
    transaction: Transaction,
    audit: AuditWriter,
    config: PiWebConfig,
    paths: PiWebPaths,
    notifications: NotificationCenter
  ) {
    super();
    this.#sessions = sessions;
    this.#transaction = transaction;
    this.#audit = audit;
    this.#config = config;
    this.#paths = paths;
    this.#history = new SessionHistory(
      sessions,
      this.#runtime,
      config.eventBufferSize,
      (sessionId, state) => {
        this.#reconcileRuntimeSettings(sessionId, state);
      },
      (event) => this.emit("event", event)
    );
    this.#notifications = notifications;
    this.#extensionInteractions = new ExtensionInteractions(
      sessions,
      notifications,
      (sessionId, runtime) =>
        this.#runtime.workers.get(sessionId) === runtime,
      (sessionId, type, payload) =>
        this.#emitEvent(sessionId, type, payload)
    );
  }

  updateConfig(config: PiWebConfig): void {
    this.#config = config;
  }

  get activeCount(): number {
    return this.#runtime.workers.size;
  }

  prepareServiceChange(force: boolean): { activeWorkers: number; forced: boolean } {
    if (this.#drainingReason !== null) {
      throw new PiWebError(
        "SESSIOND_DRAINING",
        `Session daemon is already draining for a ${this.#drainingReason} change`,
        409
      );
    }
    const activeWorkers = this.activeCount;
    if (activeWorkers > 0 && !force) {
      throw new PiWebError(
        "ACTIVE_WORKERS_BLOCK_SERVICE_CHANGE",
        `Cannot change Pi Web services while ${activeWorkers} Pi workers are active`,
        409,
        { activeWorkers }
      );
    }
    this.#drainingReason = "service";
    return { activeWorkers, forced: force && activeWorkers > 0 };
  }

  cancelServiceChange(): void {
    if (!this.#closing && this.#drainingReason === "service") {
      this.#drainingReason = null;
    }
  }

  preparePackageChange(force: boolean): { activeWorkers: number; forced: boolean } {
    if (this.#drainingReason !== null) {
      throw new PiWebError(
        "SESSIOND_DRAINING",
        `Session daemon is already draining for a ${this.#drainingReason} change`,
        409
      );
    }
    const activeWorkers = this.activeCount;
    if (activeWorkers > 0 && !force) {
      throw new PiWebError(
        "ACTIVE_WORKERS_BLOCK_PI_CHANGE",
        "Pi package changes are blocked while workers are active; close them or retry explicitly with force",
        409,
        { activeWorkers }
      );
    }
    this.#drainingReason = "package";
    return { activeWorkers, forced: force && activeWorkers > 0 };
  }

  finishPackageChange(): void {
    if (!this.#closing && this.#drainingReason === "package") {
      this.#drainingReason = null;
    }
  }

  getWorkerSessionForToken(token: string): string | null {
    return this.#runtime.workerTokens.get(token) ?? null;
  }

  list(input: { limit?: number; cursor?: string | null } = {}): SessionListPage {
    return this.#sessions.list(input);
  }

  get(id: string): SessionRecord {
    return this.#sessions.get(id);
  }

  async rename(
    id: string,
    displayName: string,
    actor = "web"
  ): Promise<SessionRecord> {
    const current = this.#sessions.get(id);
    const runtime = this.#runtime.workers.get(id);
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
    const updated = this.#sessions.rename(id, displayName, actor);
    this.#emitEvent(id, "session.renamed", { displayName });
    return updated;
  }

  pin(id: string, pinned: boolean, actor = "web"): SessionRecord {
    const updated = this.#sessions.setPinned(id, pinned, actor);
    this.#emitEvent(id, "session.pinned", { pinned });
    return updated;
  }

  assertDeletable(id: string): SessionRecord {
    const current = this.#sessions.get(id);
    if (
      this.#runtime.workers.has(id) ||
      this.#runtime.sessionStarts.has(id) ||
      this.#runtime.resumeInputQueues.has(id)
    ) {
      throw new PiWebError(
        "SESSION_BUSY",
        "Close the active session before deleting it",
        409
      );
    }
    return current;
  }

  async delete(
    id: string,
    actor = "web",
    beforeDelete?: () => void
  ): Promise<void> {
    const pending: Promise<unknown>[] = [];
    const pendingStart = this.#runtime.sessionStarts.get(id);
    const pendingResume = this.#runtime.resumeInputQueues.get(id);
    if (pendingStart) pending.push(pendingStart);
    if (pendingResume) pending.push(pendingResume);
    if (pending.length > 0) await Promise.allSettled(pending);
    if (this.#runtime.workers.has(id)) await this.close(id, actor);

    const current = this.assertDeletable(id);
    const sessionFile = current.piSessionReference;
    const stagedFile = sessionFile
      ? `${sessionFile}.pi-web-delete-${randomUUID()}`
      : null;
    let fileStaged = false;

    if (sessionFile && stagedFile) {
      clearSessionCache(sessionFile);
      try {
        await rename(sessionFile, stagedFile);
        fileStaged = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }

    try {
      this.#transaction(() => {
        beforeDelete?.();
        this.#sessions.delete(current.id, actor);
      });
    } catch (error) {
      if (fileStaged && sessionFile && stagedFile) {
        await rename(stagedFile, sessionFile).catch(() => undefined);
      }
      throw error;
    }

    this.#history.clear(id);
    if (fileStaged && stagedFile) await unlink(stagedFile);
  }

  async create(input: CreateSessionInput): Promise<SessionRecord> {
    this.#assertAcceptingStarts();
    const { mutationId, ...mutationPayload } = input;
    const mutationFingerprint = mutationId
      ? fingerprintMutationPayload(mutationPayload)
      : undefined;
    if (input.mutationId) {
      const existing = this.#sessions.findCreateMutation(
        input.mutationId
      );
      if (existing) {
        assertMutationSessionVisible(existing.session);
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
      const result = this.#sessions.createOrReuse({
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
        assertMutationSessionVisible(result.session);
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

  async fork(id: string, actor = "web"): Promise<SessionRecord> {
    this.#assertAcceptingStarts();
    const source = this.#sessions.get(id);
    if (["starting", "running", "stopping"].includes(source.status)) {
      throw new PiWebError(
        "SESSION_BUSY",
        "Wait for the current turn to finish before branching the session",
        409
      );
    }
    if (this.#runtime.workers.has(id)) {
      await this.close(id, actor);
    }
    const persisted = this.#sessions.get(id);
    if (!persisted.piSessionReference) {
      throw new PiWebError(
        "SESSION_NOT_PERSISTED",
        "This session has no Pi session file to branch",
        409
      );
    }
    await resolveAllowedDirectory(
      persisted.cwd,
      this.#config.allowedRoots,
      this.#config.allowAnyDirectory
    );
    const releaseSlot = this.#reserveWorkerSlot();
    let reservationTransferred = false;
    try {
      const displayName = `${persisted.displayName} · 分支`.slice(0, 160);
      const branch = this.#sessions.create({
        cwd: persisted.cwd,
        displayName,
        model: persisted.model,
        thinkingLevel: persisted.thinkingLevel,
        systemPrompt: persisted.systemPrompt,
        createdBy: "web"
      });
      const admission = this.#beginSessionStart(
        branch.id,
        async () =>
          await this.#startWithReservation(
            branch,
            undefined,
            undefined,
            undefined,
            releaseSlot,
            persisted.piSessionReference as string
          )
      );
      if (admission.started) reservationTransferred = true;
      else releaseSlot();
      const created = await admission.promise;
      this.#audit("session.fork", "success", actor, created.id, {
        sourceSessionId: id
      });
      return created;
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
        const currentMutation = this.#sessions.findCreateMutation(mutationId);
        if (!currentMutation) {
          throw new PiWebError(
            "CREATE_MUTATION_NOT_FOUND",
            "Create mutation could not be recovered",
            500
          );
        }
        assertMutationSessionVisible(currentMutation.session);
        if (currentMutation.completed) return currentMutation.session;
        const pending = this.#runtime.sessionStarts.get(currentMutation.session.id);
        if (pending) {
          const recovered = await pending;
          if (this.#sessions.findCreateMutation(mutationId)?.completed) {
            return recovered;
          }
          throw createMutationPendingError();
        }
        if (this.#runtime.workers.has(currentMutation.session.id)) {
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
              const latest = this.#sessions.findCreateMutation(mutationId);
              if (!latest) {
                throw new PiWebError(
                  "CREATE_MUTATION_NOT_FOUND",
                  "Create mutation could not be recovered",
                  500
                );
              }
              if (latest.completed) return latest.session;
              if (this.#runtime.workers.has(latest.session.id)) {
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
        if (this.#sessions.findCreateMutation(mutationId)?.completed) {
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
    const pendingStart = this.#runtime.sessionStarts.get(id);
    if (pendingStart) {
      await pendingStart;
      if (hasInput) {
        await this.#queueJoinedResumeInput(
          id,
          prompt?.trim() ?? "",
          images
        );
      }
      return this.#sessions.get(id);
    }
    if (this.#runtime.workers.has(id)) {
      if (hasInput) {
        await this.#queueJoinedResumeInput(
          id,
          prompt?.trim() ?? "",
          images
        );
      }
      return this.#sessions.get(id);
    }
    const admission = this.#beginSessionStart(
      id,
      async () => {
        const releaseSlot = this.#reserveWorkerSlot();
        try {
          const session = this.#sessions.get(id);
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
          if (this.#runtime.workers.has(id)) return this.#sessions.get(id);
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
    return this.#sessions.get(id);
  }

  async #queueJoinedResumeInput(
    id: string,
    message: string,
    images: PromptImage[]
  ): Promise<void> {
    this.#assertAcceptingStarts();
    const previous = this.#runtime.resumeInputQueues.get(id) ?? Promise.resolve();
    const queued = previous
      .catch(() => undefined)
      .then(async () => {
        const behavior =
          this.#sessions.get(id).status === "waiting"
            ? "prompt"
            : "follow_up";
        await this.#prompt(id, message, behavior, images);
      });
    this.#runtime.resumeInputQueues.set(id, queued);
    try {
      await queued;
    } finally {
      if (this.#runtime.resumeInputQueues.get(id) === queued) {
        this.#runtime.resumeInputQueues.delete(id);
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
    const runtime = this.#runtime.workers.get(id);
    if (!runtime) {
      throw new PiWebError(
        "SESSION_NOT_ACTIVE",
        "Resume the session before sending a message",
        409
      );
    }
    const current = this.#sessions.get(id);
    if (behavior === "prompt" && current.status !== "waiting") {
      throw new PiWebError(
        "SESSION_BUSY",
        "Use steer or follow-up while the session is running",
        409
      );
    }
    await runtime.worker.prompt(message, behavior, images);
    onAccepted?.();
    const latest = this.#sessions.get(id);
    if (latest.status === "waiting") {
      this.#setStatus(id, "running");
    }
    this.#emitEvent(id, "input.accepted", {
      behavior,
      imageCount: images.length
    });
  }

  async abort(id: string, actor = "web"): Promise<void> {
    const runtime = this.#runtime.workers.get(id);
    if (!runtime) throw new PiWebError("SESSION_NOT_ACTIVE", "Session is not active", 409);
    await runtime.worker.abort();
    const latest = this.#sessions.get(id);
    if (latest.status === "running") {
      this.#setStatus(id, "stopping");
    }
    this.#emitEvent(id, "session.abort_requested", {});
    this.#audit("session.stop", "success", actor, id);
  }

  async close(id: string, actor = "web"): Promise<void> {
    const runtime = this.#runtime.workers.get(id);
    if (!runtime) {
      const current = this.#sessions.get(id);
      if (current.status !== "closed") {
        this.#setStatus(id, "closed", { endedAt: nowIso() });
        this.#audit("session.close", "success", actor, id);
      }
      return;
    }
    runtime.closeRequested = true;
    this.#setStatus(id, "stopping");
    await runtime.worker.close();
    this.#audit("session.close", "success", actor, id);
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

  async respondToExtensionUi(
    id: string,
    response: ExtensionUiResponse
  ): Promise<{ accepted: true }> {
    return await this.#extensionInteractions.respond(
      id,
      this.#requireRuntime(id),
      response
    );
  }

  async snapshot(
    id: string,
    cursor?: string | null
  ): Promise<SessionSnapshot> {
    return await this.#history.snapshot(id, cursor);
  }

  async sync(
    id: string,
    projectionEpoch: string | null,
    afterSequence: number
  ): Promise<SessionSyncResult> {
    return await this.#history.sync(id, projectionEpoch, afterSequence);
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
      [...this.#runtime.workers.entries()].map(async ([id, runtime]) => {
        runtime.closeRequested = false;
        const row = this.#sessions.get(id);
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
      this.#runtime.workers.size > 0 ||
      this.#runtime.reservedWorkerSlots > 0
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
    return this.#runtime.beginSessionStart(id, start);
  }

  #reserveWorkerSlot(): () => void {
    this.#assertAcceptingStarts();
    return this.#runtime.reserveWorkerSlot(
      this.#config.maxConcurrentWorkers
    );
  }

  async #startWithReservation(
    session: SessionRecord,
    initialPrompt: string | undefined,
    initialImages: PromptImage[] | undefined,
    createMutationId: string | undefined,
    releaseSlot: () => void,
    forkSessionPath?: string
  ): Promise<SessionRecord> {
    try {
      await this.#start(
        session,
        initialPrompt,
        initialImages,
        createMutationId,
        forkSessionPath,
        releaseSlot
      );
      return this.#sessions.get(session.id);
    } finally {
      releaseSlot();
    }
  }

  async #start(
    session: SessionRecord,
    initialPrompt?: string,
    initialImages: PromptImage[] = [],
    createMutationId?: string,
    forkSessionPath?: string,
    onWorkerRegistered?: () => void
  ): Promise<void> {
    if (this.#runtime.workers.has(session.id)) {
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
      if (!fakePath) {
        await assertPiCompatible(
          this.#config.piExecutable,
          this.#paths.cacheDir
        );
      }
      const extensionPath =
        process.env.PI_WEB_SCHEDULER_EXTENSION ||
        fileURLToPath(import.meta.resolve("@pi-web/scheduler-extension"));
      const worker = new PiRpcWorker({
      executable: fakePath ? process.execPath : this.#config.piExecutable,
      ...(fakePath ? { prefixArgs: [fakePath] } : {}),
      cwd: session.cwd,
      name: session.displayName,
      sessionPath: forkSessionPath ? null : session.piSessionReference,
      ...(forkSessionPath ? { forkSessionPath } : {}),
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
        pendingInteractions: new Map(),
        interactionTimers: new Map(),
        respondingInteractions: new Set(),
        projection: new RunningSessionProjection({
          emitMessageUpdate: (event) =>
            this.#emitEvent(session.id, "pi.message_update", event),
          emitPiEvent: (type, event) =>
            this.#emitEvent(session.id, `pi.${type}`, event)
        })
      };
      this.#runtime.register(session.id, runtime);
      onWorkerRegistered?.();
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
      if (this.#runtime.workers.get(session.id) !== runtime) return;
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
      const updated = this.#sessions.update(session.id, {
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
                this.#sessions.completeCreateMutation(
                  session.id,
                  createMutationId
                )
            : undefined
        );
      } else {
        if (createMutationId) {
          this.#sessions.completeCreateMutation(session.id, createMutationId);
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
    if (this.#closing || this.#runtime.workers.get(id) !== runtime) return;
    const eventType = typeof event.type === "string" ? event.type : "unknown";
    if (eventType === "extension_ui_request") {
      this.#extensionInteractions.handleRequest(id, runtime, event);
      return;
    }
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
        const updated = this.#sessions.updateUsage(id, usage);
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
    const session = this.#sessions.get(id);
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
        const updated = this.#sessions.updateUsage(id, read.usage);
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
    const current = this.#sessions.get(id);
    if (current.status === "running" || current.status === "stopping") {
      const settled = this.#setStatus(id, "waiting", { settledAt: nowIso() });
      if (!settled.scheduleRunId) {
        this.#notifications.sessionSettled(settled);
      }
    }
  }

  #onWorkerExit(
    id: string,
    runtime: WorkerRuntime,
    info: Record<string, unknown>
  ): void {
    runtime.projection.flush();
    this.#extensionInteractions.clear(id, runtime);
    if (!this.#runtime.unregister(id, runtime)) return;
    const current = this.#sessions.get(id);
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
      this.#audit("session.interrupted", "failure", "system", id, {
        exitCode: code
      });
      const interrupted = this.#sessions.get(id);
      if (!interrupted.scheduleRunId) {
        this.#notifications.sessionFailed(
          interrupted,
          `worker-exit:${interrupted.lastEventSequence + 1}`,
          interrupted.interruptionReason ?? "Pi RPC worker exited unexpectedly"
        );
      }
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
    const runtime = this.#runtime.workers.get(id);
    if (expectedRuntime && runtime !== expectedRuntime) {
      expectedRuntime.projection.flush();
      this.#extensionInteractions.clear(id, expectedRuntime);
      this.#runtime.workerTokens.delete(expectedRuntime.token);
      await expectedRuntime.worker.close(1000);
      if (runtime) return;
    }
    if (runtime) {
      runtime.projection.flush();
      this.#extensionInteractions.clear(id, runtime);
      this.#runtime.workerTokens.delete(runtime.token);
    }
    const message = safeErrorMessage(error);
    const failed = this.#sessions.update(id, {
      status: "failed",
      workerPid: null,
      endedAt: nowIso(),
      interruptionReason: message
    });
    this.#emitEvent(id, "session.start_failed", { message });
    this.#audit("session.failed", "failure", "system", id, { message });
    if (!failed.scheduleRunId) {
      this.#notifications.sessionFailed(
        failed,
        `startup:${failed.lastEventSequence + 1}`,
        message
      );
    }
    this.emit("status", failed);
    if (runtime) {
      await runtime.worker.close(1000);
    }
  }

  #trackBackgroundTask(task: Promise<void>): void {
    this.#runtime.track(task);
  }

  async #drainLifecycleTasks(): Promise<void> {
    await this.#runtime.drain();
  }

  #assertAcceptingStarts(): void {
    if (this.#closing || this.#drainingReason !== null) {
      throw new PiWebError(
        this.#closing ? "SESSIOND_STOPPING" : "SESSIOND_DRAINING",
        this.#closing
          ? "Session daemon is stopping"
          : `Session daemon is draining for a ${this.#drainingReason} change`,
        503
      );
    }
  }

  #setStatus(
    id: string,
    status: SessionStatus,
    patch: Partial<SessionRecord> = {}
  ): SessionRecord {
    const current = this.#sessions.get(id);
    assertTransition(current.status, status);
    const updated = this.#sessions.update(id, {
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
    return this.#history.emit(id, type, payload);
  }

  #requireRuntime(id: string): WorkerRuntime {
    const runtime = this.#runtime.workers.get(id);
    if (!runtime) throw new PiWebError("SESSION_NOT_ACTIVE", "Session is not active", 409);
    return runtime;
  }

  #runtimeGenerationMatches(
    id: string,
    runtime: WorkerRuntime,
    activityGeneration: number
  ): boolean {
    return runtimeGenerationIsCurrent(
      this.#runtime.workers.get(id),
      runtime,
      runtime.activityGeneration,
      activityGeneration
    );
  }

  #reconcileRuntimeSettings(
    id: string,
    state: Record<string, unknown>
  ): SessionRecord {
    const current = this.#sessions.get(id);
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
    return this.#sessions.update(id, { model, thinkingLevel });
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
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

function assertMutationSessionVisible(session: SessionRecord): void {
  if (!session.deletedAt) return;
  throw new PiWebError(
    "SESSION_DELETED",
    "The session created by this mutation was deleted",
    410
  );
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
