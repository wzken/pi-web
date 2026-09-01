import { randomUUID } from "node:crypto";
import {
  PiSessionCursorError,
  readPiSession
} from "@pi-web/pi-session-reader";
import type {
  PiMessage,
  RealtimeEvent,
  SessionSnapshot,
  SessionSyncResult,
  SessionTreeSnapshot,
  UsageSummary
} from "@pi-web/protocol";
import { nowIso, PiWebError, safeErrorMessage } from "@pi-web/shared";
import { SessionEventBuffer } from "./event-buffer.js";
import { RuntimeRegistry } from "./runtime-registry.js";
import { SessionStore } from "./session-store.js";

export class SessionHistory {
  readonly epoch = randomUUID();
  readonly #events: SessionEventBuffer;

  constructor(
    private readonly sessions: SessionStore,
    private readonly runtime: RuntimeRegistry,
    capacity: number,
    private readonly reconcileRuntimeSettings: (
      sessionId: string,
      state: Record<string, unknown>
    ) => void,
    private readonly publish: (event: RealtimeEvent) => void
  ) {
    this.#events = new SessionEventBuffer(capacity);
  }

  clear(sessionId: string): void {
    this.#events.clear(sessionId);
  }

  currentSequence(sessionId: string, persisted: number): number {
    return Math.max(persisted, this.#events.latestSequence(sessionId));
  }

  replay(sessionId: string, afterSequence: number) {
    return this.#events.replay(sessionId, afterSequence);
  }

  emit(sessionId: string, type: string, payload: unknown): RealtimeEvent {
    const current = this.sessions.get(sessionId);
    const sequence =
      this.currentSequence(sessionId, current.lastEventSequence) + 1;
    const event: RealtimeEvent = {
      sessionId,
      projectionEpoch: this.epoch,
      sequence,
      type,
      timestamp: nowIso(),
      payload
    };
    const eviction = this.#events.append(event);
    if (eviction) {
      const evictedSession = this.sessions.get(eviction.sessionId);
      if (evictedSession.lastEventSequence < eviction.latestSequence) {
        this.sessions.update(eviction.sessionId, {
          lastEventSequence: eviction.latestSequence
        });
      }
    }
    if (sequence % 25 === 0 || !type.endsWith("message_update")) {
      this.sessions.update(sessionId, { lastEventSequence: sequence });
    }
    this.publish(event);
    return event;
  }

  async snapshot(
    sessionId: string,
    cursor?: string | null
  ): Promise<SessionSnapshot> {
    const requireStableBoundary = runtimeHistoryFallbackAllowed(cursor);
    const maxAttempts = requireStableBoundary ? 4 : 1;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const runtime = this.runtime.workers.get(sessionId);
      const boundarySession = this.sessions.get(sessionId);
      const boundarySequence = this.currentSequence(
        sessionId,
        boundarySession.lastEventSequence
      );
      let state = runtime?.worker.state ?? null;
      let sessionStats: Record<string, unknown> | null = null;

      if (runtime) {
        try {
          state = await runtime.worker.refreshState();
          this.reconcileRuntimeSettings(sessionId, state);
          try {
            const response = await runtime.worker.send({
              type: "get_session_stats"
            });
            const stats = asRecord(response.data);
            sessionStats = stats;
            const usage = usageFromSessionStats(stats);
            if (usage) this.sessions.updateUsage(sessionId, usage);
          } catch (error) {
            if (!isUnsupportedPiCommand(error)) throw error;
          }
        } catch (error) {
          if (this.runtime.workers.get(sessionId) === runtime) throw error;
          continue;
        }
      }

      const session = this.sessions.get(sessionId);
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
          this.sessions.updateUsage(sessionId, read.usage);
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

      const projectionRuntime = this.runtime.workers.get(sessionId);
      if (requireStableBoundary && projectionRuntime !== runtime) continue;
      const projection =
        projectionRuntime?.projection.synchronizedSnapshot() ?? {
          recentToolEvents: [],
          liveText: "",
          queuedMessages: { steering: [], followUp: [] }
        };
      const refreshed = this.sessions.get(sessionId);
      const sequence = this.currentSequence(
        sessionId,
        refreshed.lastEventSequence
      );
      if (requireStableBoundary && sequence !== boundarySequence) continue;
      if (historyWarning) {
        this.emit(sessionId, "session.snapshot_warning", {
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
        pendingInteractions: projectionRuntime
          ? [...projectionRuntime.pendingInteractions.values()]
          : [],
        tree,
        projectionEpoch: this.epoch,
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
    sessionId: string,
    projectionEpoch: string | null,
    afterSequence: number
  ): Promise<SessionSyncResult> {
    if (projectionEpoch !== this.epoch) {
      return { mode: "snapshot", snapshot: await this.snapshot(sessionId) };
    }
    const replay = this.replay(sessionId, afterSequence);
    const session = this.sessions.get(sessionId);
    const sequence = this.currentSequence(
      sessionId,
      session.lastEventSequence
    );
    const replayedThrough = replay.events.at(-1)?.sequence ?? afterSequence;
    if (replay.available && replayedThrough === sequence) {
      return {
        mode: "incremental",
        projectionEpoch: this.epoch,
        events: replay.events,
        sequence
      };
    }
    return { mode: "snapshot", snapshot: await this.snapshot(sessionId) };
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

export function runtimeHistoryFallbackAllowed(cursor?: string | null): boolean {
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

export function isUnsupportedPiCommand(error: unknown): boolean {
  return (
    error instanceof PiWebError &&
    error.code === "PI_RPC_REJECTED" &&
    /unknown|unsupported|not implemented/i.test(error.message)
  );
}
