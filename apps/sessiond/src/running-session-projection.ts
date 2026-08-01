import {
  extractPiTextDelta,
  type QueuedMessages,
  type RealtimeEvent
} from "@pi-web/protocol";
import { MessageUpdateBatch } from "./message-update-batch.js";

const recentToolEventLimit = 50;
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
  #recentToolEvents: RealtimeEvent[] = [];
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

    this.#messageUpdates.flush();
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
      this.#recentToolEvents.push(emitted);
      if (this.#recentToolEvents.length > recentToolEventLimit) {
        this.#recentToolEvents.splice(
          0,
          this.#recentToolEvents.length - recentToolEventLimit
        );
      }
    }
    return type;
  }

  flush(): void {
    this.#messageUpdates.flush();
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
      isError: event.isError === true
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

function boundedString(value: unknown): string | undefined {
  return typeof value === "string"
    ? value.slice(0, eventStringLimit)
    : undefined;
}
