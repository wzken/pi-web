import type {
  RealtimeEvent,
  SessionSnapshot,
  SessionStatus,
  ThinkingLevel
} from "@pi-web/protocol";
import type {
  ActivityItem,
  SessionDetailState
} from "../types";
import { asRecord, extractText } from "./session-parsing";

const liveTextCharacterLimit = 1_000_000;

export function snapshotToolEvents(
  snapshot: SessionSnapshot
): RealtimeEvent[] {
  const events: unknown = snapshot.recentToolEvents;
  if (!Array.isArray(events)) return [];
  return events.filter(
    (event): event is RealtimeEvent =>
      Boolean(event) &&
      typeof event === "object" &&
      typeof (event as RealtimeEvent).type === "string" &&
      typeof (event as RealtimeEvent).sequence === "number"
  );
}

export function shouldReconcileSnapshot(event: RealtimeEvent): boolean {
  return (
    event.type === "pi.message_end" ||
    event.type === "pi.agent_settled" ||
    event.type === "session.ready" ||
    event.type === "session.worker_exit"
  );
}

export function mergeActivityEvent(
  items: ActivityItem[],
  event: RealtimeEvent
): ActivityItem[] {
  const payload = asRecord(event.payload);
  const id = String(payload.toolCallId ?? payload.id ?? `${event.sequence}`);
  const next: ActivityItem = {
    id,
    type: event.type,
    name: String(payload.toolName ?? "tool"),
    status:
      payload.status === "done" || payload.status === "error"
        ? payload.status
        : event.type.endsWith("_end")
          ? payload.isError
            ? "error"
            : "done"
          : "running",
    payload,
    at: event.timestamp
  };
  const existing = items.findIndex((item) => item.id === id);
  if (existing < 0) return [...items, next];
  const copy = [...items];
  copy[existing] = next;
  return copy;
}

export function applyRealtimeEvent(
  state: SessionDetailState,
  event: RealtimeEvent
): SessionDetailState {
  let snapshot = state.snapshot;
  if (snapshot && snapshot.session.id === event.sessionId) {
    const payload = asRecord(event.payload);
    const pendingInteractions =
      event.type === "extension_ui.pending" && typeof payload.id === "string"
        ? [
            ...snapshot.pendingInteractions.filter(
              (interaction) => interaction.id !== payload.id
            ),
            payload as unknown as SessionSnapshot["pendingInteractions"][number]
          ]
        : (event.type === "extension_ui.resolved" ||
              event.type === "extension_ui.expired") &&
            typeof payload.interactionId === "string"
          ? snapshot.pendingInteractions.filter(
              (interaction) => interaction.id !== payload.interactionId
            )
          : snapshot.pendingInteractions;
    const queuedMessages =
      event.type === "pi.queue_update"
        ? {
            steering: stringArray(payload.steering),
            followUp: stringArray(payload.followUp)
          }
        : snapshot.queuedMessages;
    if (event.type === "session.status" && typeof payload.status === "string") {
      snapshot = {
        ...snapshot,
        sequence: event.sequence,
        pendingInteractions,
        queuedMessages,
        session: {
          ...snapshot.session,
          status: payload.status as SessionStatus,
          updatedAt: event.timestamp
        }
      };
    } else if (
      event.type === "session.renamed" &&
      typeof payload.displayName === "string"
    ) {
      snapshot = {
        ...snapshot,
        sequence: event.sequence,
        pendingInteractions,
        queuedMessages,
        session: {
          ...snapshot.session,
          displayName: payload.displayName,
          updatedAt: event.timestamp
        }
      };
    } else if (event.type === "session.model_changed") {
      snapshot = {
        ...snapshot,
        sequence: event.sequence,
        pendingInteractions,
        queuedMessages,
        session: {
          ...snapshot.session,
          model:
            typeof payload.model === "string" || payload.model === null
              ? payload.model
              : snapshot.session.model,
          thinkingLevel:
            typeof payload.thinkingLevel === "string" ||
            payload.thinkingLevel === null
              ? (payload.thinkingLevel as ThinkingLevel | null)
              : snapshot.session.thinkingLevel,
          updatedAt: event.timestamp
        }
      };
    } else if (event.type === "session.thinking_changed") {
      snapshot = {
        ...snapshot,
        sequence: event.sequence,
        pendingInteractions,
        queuedMessages,
        session: {
          ...snapshot.session,
          thinkingLevel:
            typeof payload.thinkingLevel === "string" ||
            payload.thinkingLevel === null
              ? (payload.thinkingLevel as ThinkingLevel | null)
              : snapshot.session.thinkingLevel,
          updatedAt: event.timestamp
        }
      };
    } else if (
      event.type === "session.pinned" &&
      typeof payload.pinned === "boolean"
    ) {
      snapshot = {
        ...snapshot,
        sequence: event.sequence,
        pendingInteractions,
        queuedMessages,
        session: {
          ...snapshot.session,
          pinned: payload.pinned,
          updatedAt: event.timestamp
        }
      };
    } else {
      snapshot = {
        ...snapshot,
        sequence: event.sequence,
        pendingInteractions,
        queuedMessages
      };
    }
  }

  const text =
    event.type === "pi.message_update" ? extractText(event.payload) : "";
  const liveText =
    event.type === "pi.agent_start" || event.type === "pi.message_end"
      ? ""
      : text
        ? `${state.liveText}${text}`.slice(-liveTextCharacterLimit)
        : state.liveText;
  const activities =
    event.type === "pi.agent_settled"
      ? []
      : event.type.startsWith("pi.tool_execution_")
        ? mergeActivityEvent(state.activities, event).slice(-50)
        : state.activities;

  return {
    ...state,
    snapshot,
    activities,
    liveText
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
