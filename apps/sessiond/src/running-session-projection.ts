import {
  extractPiTextDelta,
  type QueuedMessages,
  type RealtimeEvent
} from "@pi-web/protocol";
import { MessageUpdateBatch } from "./message-update-batch.js";

const recentToolEventLimit = 50;
const toolUpdateDelayMs = 100;
const liveTextCharacterLimit = 1_000_000;
const queuedMessageLimit = 100;
const queuedMessageCharacterLimit = 16_384;
const queuedMessagesTotalCharacterLimit = 256 * 1024;
const eventStringLimit = 2_000;

export interface RunningSessionProjectionSnapshot {
  recentToolEvents: RealtimeEvent[];
  liveText: string;
  queuedMessages: QueuedMessages;
}

interface RunningSessionProjectionOptions {
  emitMessageUpdate: (event: Record<string, unknown>) => void;
  emitPiEvent: (
    type: string,
    event: Record<string, unknown>
  ) => RealtimeEvent;
}

/**
 * A bounded, in-memory view of transient Pi RPC events for short reconnects.
 * Durable conversation state remains in Pi's session JSONL.
 */
export class RunningSessionProjection {
  readonly #messageUpdates: MessageUpdateBatch;
  readonly #emitPiEvent: RunningSessionProjectionOptions["emitPiEvent"];
  readonly #pendingToolUpdates = new Map<string, Record<string, unknown>>();
  #toolUpdateTimer: NodeJS.Timeout | null = null;
  #recentToolEvents: RealtimeEvent[] = [];
  #toolEventIndexes = new Map<string, number>();
  #liveText = "";
  #queuedMessages: QueuedMessages = { steering: [], followUp: [] };

  constructor(options: RunningSessionProjectionOptions) {
    this.#messageUpdates = new MessageUpdateBatch(options.emitMessageUpdate);
    this.#emitPiEvent = options.emitPiEvent;
  }

  ingest(event: Record<string, unknown>): string | null {
    const type = typeof event.type === "string" ? event.type : "unknown";
    if (type === "message_update") {
      const delta = extractPiTextDelta(event);
      if (delta) {
        this.#liveText = `${this.#liveText}${delta}`.slice(
          -liveTextCharacterLimit
        );
        this.#messageUpdates.push(delta);
      }
      return null;
    }

    if (type === "tool_execution_update") {
      const toolCallId = boundedString(event.toolCallId ?? event.id);
      if (!toolCallId) return null;
      if (!this.#pendingToolUpdates.has(toolCallId)) {
        while (this.#pendingToolUpdates.size >= recentToolEventLimit) {
          const oldest = this.#pendingToolUpdates.keys().next().value as
            | string
            | undefined;
          if (!oldest) break;
          this.#pendingToolUpdates.delete(oldest);
        }
      }
      this.#pendingToolUpdates.set(toolCallId, event);
      if (!this.#toolUpdateTimer) {
        this.#toolUpdateTimer = setTimeout(
          () => this.#flushToolUpdates(),
          toolUpdateDelayMs
        );
        this.#toolUpdateTimer.unref();
      }
      return null;
    }

    this.#messageUpdates.flush();
    this.#flushToolUpdates();
    if (type === "agent_start") {
      this.#recentToolEvents = [];
      this.#toolEventIndexes.clear();
    }
    if (type === "agent_start" || type === "message_end") {
      this.#liveText = "";
    }
    if (type === "queue_update") {
      this.#queuedMessages = normalizeQueuedMessages(event);
    }

    const emitted = this.#emitPiEvent(
      type,
      projectTransientPiEvent(type, event, this.#queuedMessages)
    );
    if (type.startsWith("tool_execution_")) {
      this.#mergeToolEvent(emitted);
    }
    if (type === "agent_settled") {
      this.#recentToolEvents = [];
      this.#toolEventIndexes.clear();
    }
    return type;
  }

  #mergeToolEvent(event: RealtimeEvent): void {
    const payload = asRecord(event.payload);
    const toolCallId =
      typeof payload.toolCallId === "string"
        ? payload.toolCallId
        : `sequence-${event.sequence}`;
    const existingIndex = this.#toolEventIndexes.get(toolCallId);
    if (existingIndex === undefined) {
      this.#recentToolEvents.push(event);
      this.#toolEventIndexes.set(toolCallId, this.#recentToolEvents.length - 1);
    } else {
      this.#recentToolEvents[existingIndex] = event;
    }
    while (this.#recentToolEvents.length > recentToolEventLimit) {
      this.#recentToolEvents.shift();
      this.#reindexToolEvents();
    }
  }

  #reindexToolEvents(): void {
    this.#toolEventIndexes.clear();
    this.#recentToolEvents.forEach((event, index) => {
      const toolCallId = asRecord(event.payload).toolCallId;
      if (typeof toolCallId === "string") {
        this.#toolEventIndexes.set(toolCallId, index);
      }
    });
  }

  #flushToolUpdates(): void {
    if (this.#toolUpdateTimer) {
      clearTimeout(this.#toolUpdateTimer);
      this.#toolUpdateTimer = null;
    }
    if (this.#pendingToolUpdates.size === 0) return;
    const pending = [...this.#pendingToolUpdates.values()];
    this.#pendingToolUpdates.clear();
    for (const event of pending) {
      const emitted = this.#emitPiEvent(
        "tool_execution_update",
        projectTransientPiEvent(
          "tool_execution_update",
          event,
          this.#queuedMessages
        )
      );
      this.#mergeToolEvent(emitted);
    }
  }

  flush(): void {
    this.#messageUpdates.flush();
    this.#flushToolUpdates();
  }

  synchronizedSnapshot(): RunningSessionProjectionSnapshot {
    this.flush();
    return this.snapshot();
  }

  snapshot(): RunningSessionProjectionSnapshot {
    return {
      recentToolEvents: [...this.#recentToolEvents],
      liveText: this.#liveText,
      queuedMessages: {
        steering: [...this.#queuedMessages.steering],
        followUp: [...this.#queuedMessages.followUp]
      }
    };
  }
}

function normalizeQueuedMessages(value: unknown): QueuedMessages {
  const record = asRecord(value);
  return {
    steering: stringArray(record.steering),
    followUp: stringArray(record.followUp)
  };
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  let remaining = queuedMessagesTotalCharacterLimit;
  for (const item of value) {
    if (typeof item !== "string" || remaining <= 0) continue;
    const bounded = item.slice(
      0,
      Math.min(queuedMessageCharacterLimit, remaining)
    );
    result.push(bounded);
    remaining -= bounded.length;
    if (result.length >= queuedMessageLimit) break;
  }
  return result;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function projectTransientPiEvent(
  type: string,
  event: Record<string, unknown>,
  queuedMessages: QueuedMessages
): Record<string, unknown> {
  if (type === "queue_update") {
    return {
      type,
      steering: [...queuedMessages.steering],
      followUp: [...queuedMessages.followUp]
    };
  }
  if (type.startsWith("tool_execution_")) {
    return {
      type,
      toolCallId: boundedString(event.toolCallId ?? event.id),
      toolName: boundedString(event.toolName),
      status: type.endsWith("_end")
        ? event.isError === true
          ? "error"
          : "done"
        : "running",
      isError: event.isError === true,
      outputPreview: boundedToolPreview(
        type.endsWith("_end")
          ? event.result ?? event.output
          : event.partialResult ?? event.result ?? event.output
      )
    };
  }
  if (type === "extension_error") {
    return {
      type,
      message: boundedString(event.message ?? event.error),
      extensionPath: boundedString(event.extensionPath ?? event.path)
    };
  }
  return { type };
}

function boundedToolPreview(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value.slice(0, 8_192);
  try {
    return JSON.stringify(value, null, 2).slice(0, 8_192);
  } catch {
    return String(value).slice(0, 8_192);
  }
}

function boundedString(value: unknown): string | undefined {
  return typeof value === "string"
    ? value.slice(0, eventStringLimit)
    : undefined;
}
