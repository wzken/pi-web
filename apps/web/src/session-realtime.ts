export function resolveAfterSequence(
  stored: string | null,
  fallback: number
): number {
  if (stored === null) return fallback;
  const parsed = Number(stored);
  return Number.isSafeInteger(parsed) && parsed >= 0
    ? Math.max(parsed, fallback)
    : fallback;
}

export function isNewerSequence(
  latest: number,
  incoming: number
): boolean {
  return (
    Number.isSafeInteger(incoming) &&
    incoming >= 0 &&
    incoming > latest
  );
}

export function parseSessionSocketMessage(
  data: unknown
): ParsedSessionSocketMessage | null {
  if (typeof data !== "string") return null;
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  if (
    value.type === "sync" &&
    value.mode === "snapshot" &&
    isSessionSnapshot(value.snapshot)
  ) {
    return { type: "snapshot", snapshot: value.snapshot };
  }
  if (
    value.type === "sync" &&
    value.mode === "incremental" &&
    Array.isArray(value.events)
  ) {
    return {
      type: "incremental",
      events: value.events.filter(isRealtimeEvent)
    };
  }
  if (value.type === "event" && isRealtimeEvent(value.event)) {
    return { type: "event", event: value.event };
  }
  return null;
}

function isSessionSnapshot(value: unknown): value is SessionSnapshot {
  if (!isRecord(value) || !isRecord(value.session)) return false;
  return (
    typeof value.session.id === "string" &&
    Number.isSafeInteger(value.sequence) &&
    (value.sequence as number) >= 0
  );
}

function isRealtimeEvent(value: unknown): value is RealtimeEvent {
  if (!isRecord(value)) return false;
  return (
    typeof value.sessionId === "string" &&
    Number.isSafeInteger(value.sequence) &&
    (value.sequence as number) >= 0 &&
    typeof value.type === "string" &&
    typeof value.timestamp === "string" &&
    "payload" in value
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
import type { RealtimeEvent, SessionSnapshot } from "@pi-web/protocol";

export type ParsedSessionSocketMessage =
  | { type: "snapshot"; snapshot: SessionSnapshot }
  | { type: "incremental"; events: RealtimeEvent[] }
  | { type: "event"; event: RealtimeEvent };
