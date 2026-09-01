import type { PiMessage } from "@pi-web/protocol";
import { messageToPlainText } from "../../../session-messages";
import type { ActivityItem } from "../types";

export interface ToolResultGroupItem {
  message: PiMessage;
  messageIndex: number;
}

type TimelineItem =
  | { kind: "message"; key: string; message: PiMessage; messageIndex: number }
  | { kind: "tool-group"; key: string; messages: ToolResultGroupItem[] }
  | { kind: "activity"; key: string; activity: ActivityItem }
  | { kind: "live"; key: string; text: string };

export function deduplicateActivities(
  messages: PiMessage[],
  activities: ActivityItem[]
): ActivityItem[] {
  const historicalIds = new Set(
    messages.flatMap((message) =>
      message.role === "toolResult" && typeof message.toolCallId === "string"
        ? [message.toolCallId]
        : []
    )
  );
  return activities.filter((activity) => !historicalIds.has(activity.id));
}

export function buildTimelineItems(
  messages: PiMessage[],
  activities: ActivityItem[],
  liveText: string,
  running: boolean,
  hiddenMessageKeys: Set<string>
): TimelineItem[] {
  const base: TimelineItem[] = [];
  let pendingTools: ToolResultGroupItem[] = [];
  const flushTools = () => {
    if (pendingTools.length === 0) return;
    base.push({
      kind: "tool-group",
      key: `tool-group-${messageStorageKey(pendingTools[0]!.message)}`,
      messages: pendingTools
    });
    pendingTools = [];
  };

  messages.forEach((message, messageIndex) => {
    const key = messageStorageKey(message);
    if (hiddenMessageKeys.has(key)) return;
    if (message.role === "toolResult") {
      pendingTools.push({ message, messageIndex });
      return;
    }
    flushTools();
    base.push({ kind: "message", key, message, messageIndex });
  });
  flushTools();

  for (const activity of activities) {
    base.push({
      kind: "activity",
      key: `activity-${activity.id}`,
      activity
    });
  }
  if (running && liveText) {
    base.push({ kind: "live", key: "live", text: liveText });
  }
  return base;
}

function hiddenMessagesStorageKey(sessionId: string): string {
  return `pi-web:hidden-messages:${sessionId}`;
}

export function readHiddenMessages(sessionId: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const value = JSON.parse(window.localStorage.getItem(hiddenMessagesStorageKey(sessionId)) ?? "[]");
    return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

export function writeHiddenMessages(sessionId: string, keys: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(hiddenMessagesStorageKey(sessionId), JSON.stringify([...keys]));
  } catch {
    // Hiding remains available for this page when browser storage is unavailable.
  }
}

export function messageStorageKey(message: PiMessage): string {
  const source = `${message.role}\u0000${String(message.timestamp ?? "")}\u0000${messageToPlainText(message)}\u0000${String(message.model ?? "")}`;
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `message-${(hash >>> 0).toString(36)}`;
}
